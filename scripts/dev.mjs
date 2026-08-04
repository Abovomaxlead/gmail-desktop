// Ontwikkelmodus zonder herstarten met de hand.
//
//   npm run dev
//
// Drie soorten wijzigingen, drie snelheden:
//   renderer (zijbalk, modal)  -> hot reload via de Next-devserver, niets merkbaar
//   preload  (dropzone)        -> esbuild bouwt, main herlaadt de Gmail-views
//   main                       -> esbuild bouwt, Electron start automatisch opnieuw
//
// Alleen esbuild en Next, geen extra afhankelijkheden.
import { spawn } from 'node:child_process';
import { context } from 'esbuild';
import electron from 'electron';

const RENDERER_URL = process.env.RENDERER_URL ?? 'http://localhost:3000';

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  external: ['electron'],
  outdir: 'dist-electron',
  format: 'cjs',
  logLevel: 'silent',
};

let child = null;
let restarting = false;
let stopping = false;

function startElectron() {
  child = spawn(electron, ['.'], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RENDERER_URL: RENDERER_URL },
  });
  child.on('exit', (code) => {
    child = null;
    // Sluit de gebruiker de app zelf, dan stopt de hele boel — maar niet als wij
    // hem net aan het herstarten zijn.
    if (!restarting && !stopping) shutdown(code ?? 0);
  });
}

async function restartElectron() {
  if (!child) return startElectron();
  restarting = true;
  const dead = new Promise((r) => child.once('exit', r));
  child.kill();
  await dead;
  restarting = false;
  console.log('\n› main opnieuw gebouwd — Electron herstart\n');
  startElectron();
}

// esbuild meldt elke build; de eerste is de initiële en mag niets herstarten.
function afterBuild(name, onRebuild) {
  let first = true;
  return {
    name: `na-${name}`,
    setup(build) {
      build.onEnd((result) => {
        if (result.errors.length > 0) {
          console.error(`\n✗ ${name}: ${result.errors.length} fout(en) — niet herladen\n`);
          for (const e of result.errors) console.error(`  ${e.text}`);
          return;
        }
        if (first) {
          first = false;
          return;
        }
        onRebuild();
      });
    },
  };
}

async function waitForRenderer() {
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(RENDERER_URL);
      if (res.ok) return true;
    } catch {
      // devserver nog niet op
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

const next = spawn('npm', ['run', 'dev', '--prefix', 'renderer'], {
  shell: true,
  stdio: 'inherit',
});

function shutdown(code) {
  if (stopping) return;
  stopping = true;
  child?.kill();
  next.kill();
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

// Twee losse watchers: alleen een wijziging in main hoeft een herstart. Een
// nieuwe preload wordt door main zelf opgepikt (het let op het bestand) en met
// een herlaad van de views doorgevoerd.
const mainCtx = await context({
  ...shared,
  entryPoints: ['electron/main.ts'],
  plugins: [afterBuild('main', () => void restartElectron())],
});
const preloadCtx = await context({
  ...shared,
  entryPoints: ['electron/preload.ts', 'electron/sidebar-preload.ts', 'electron/compose-preload.ts'],
  plugins: [afterBuild('preload', () => console.log('\n› preload opnieuw gebouwd — views herladen\n'))],
});

await mainCtx.watch();
await preloadCtx.watch();
console.log('› main/preload in watch-modus');

console.log(`› wachten op de renderer op ${RENDERER_URL}…`);
if (!(await waitForRenderer())) {
  console.error('✗ renderer kwam niet op; is `npm install` in renderer/ gedaan?');
  shutdown(1);
}

console.log('› Electron starten\n');
startElectron();
