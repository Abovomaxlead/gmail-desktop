// Icons for the Google app surfaces in the sidebar: the official product icons
// (embedded PNGs, see lib/app-icon-data.ts). Mail and calendar are pinned with their
// own visuals and never render through APP_ICONS.
import type { FC } from 'react';
import type { Surface } from '../lib/surfaces';
import { APP_ICON_DATA_URIS } from '../lib/app-icon-data';

interface IconProps {
  className?: string;
}

function productIcon(surface: Surface): FC<IconProps> {
  const src = APP_ICON_DATA_URIS[surface];
  return function ProductIcon({ className = '' }: IconProps) {
    return <img src={src} alt="" draggable={false} className={className} />;
  };
}

export const APP_ICONS: Partial<Record<Surface, FC<IconProps>>> = {
  drive: productIcon('drive'),
  docs: productIcon('docs'),
  sheets: productIcon('sheets'),
  slides: productIcon('slides'),
  keep: productIcon('keep'),
  contacts: productIcon('contacts'),
  chat: productIcon('chat'),
};
