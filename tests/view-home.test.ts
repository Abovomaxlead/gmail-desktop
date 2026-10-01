// Whether a view is still sitting on the URL the app opened it with.
//
// A view's identity is the URL it was built from, and nothing used to remember it: reload
// called webContents.reload(), which reloads wherever the page has since ended up. A
// delegated mailbox opened while signed out redirects to a login page and, once the user
// signs back in, lands on the signed-in account's own inbox -- so a reload cemented the
// wrong mailbox in the delegated view instead of recovering it.
//
// Judged on segments and never on raw string prefixes, so /mail/u/1/ is not read as the
// home of /mail/u/10/. The hash is ignored, because Gmail routes the whole mailbox through
// it: a thread open at #inbox/FMfcg... has not left its mailbox and must reload as itself.

import { describe, it, expect } from 'vitest';
import { viewLeftItsHome } from '../electron/windows/view-home';

const OWN = 'https://mail.google.com/mail/u/0/';
const DELEGATED = 'https://mail.google.com/mail/u/0/d/AOr0Kc1x9Qm/';

describe('viewLeftItsHome', () => {
  it('says a view that never moved is home', () => {
    expect(viewLeftItsHome(OWN, OWN)).toBe(false);
  });

  // Gmail routes every mailbox through the hash, so an open conversation is still the inbox
  // it was opened at -- and Ctrl+R on a thread has to reload that thread.
  it('says an open conversation is still home', () => {
    expect(viewLeftItsHome(OWN, `${OWN}#inbox/FMfcgzQbfWxHDpTvvGkGVBSTblhcNvpk`)).toBe(false);
  });

  it('ignores a query Google appended', () => {
    expect(viewLeftItsHome(OWN, `${OWN}?pli=1#inbox`)).toBe(false);
  });

  // The report this exists for: signed out, the delegated url answers with a login page.
  it('says a view sent to the login page has left home', () => {
    expect(
      viewLeftItsHome(DELEGATED, 'https://accounts.google.com/ServiceLogin?continue=x'),
    ).toBe(true);
  });

  // And what signing back in leaves behind: the delegated segment is gone, so the view is
  // showing the signed-in account's own mail under a delegated profile.
  it('says a delegated view dropped on the own inbox has left home', () => {
    expect(viewLeftItsHome(DELEGATED, OWN)).toBe(true);
  });

  it('says a delegated view is home while it is still under its own segment', () => {
    expect(viewLeftItsHome(DELEGATED, `${DELEGATED}#inbox`)).toBe(false);
  });

  // A rotated id is a different mailbox url, not a deeper page of the same one.
  it('says another delegation id is not home', () => {
    expect(viewLeftItsHome(DELEGATED, 'https://mail.google.com/mail/u/0/d/AOr0Kc9zzzz/')).toBe(
      true,
    );
  });

  // Segments, not characters: /mail/u/1/ must not swallow /mail/u/10/.
  it('does not read one account index as the home of another', () => {
    expect(
      viewLeftItsHome('https://mail.google.com/mail/u/1/', 'https://mail.google.com/mail/u/10/'),
    ).toBe(true);
  });

  it('says another surface is not home', () => {
    expect(viewLeftItsHome(OWN, 'https://drive.google.com/drive/u/0/my-drive')).toBe(true);
  });

  // Nothing to compare is not a soft "left home": a url the app cannot read must never cost
  // the user the page they were on.
  it('answers false when either url is missing', () => {
    expect(viewLeftItsHome(null, OWN)).toBe(false);
    expect(viewLeftItsHome(OWN, null)).toBe(false);
    expect(viewLeftItsHome(OWN, '')).toBe(false);
  });

  it('answers false for a url it cannot parse', () => {
    expect(viewLeftItsHome(OWN, 'not a url')).toBe(false);
  });
});
