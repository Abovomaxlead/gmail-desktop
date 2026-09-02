// What emptying a label answers, in renderer/lib so the settings section and the bridge
// declaration read the same shapes.
//
// Counting and purging are two steps: the count hands out a handle, and the purge sends that
// handle back, so what goes away is what was counted rather than whatever is under the label
// by the time the button is pressed.


//===========================
// Types
//===========================

export interface PurgeLabel {
  name: string;
  labelId: string;
  messages: number;
}

export interface LabelPurgeCount {
  handle: string;
  email: string;
  label: string;
  labels: PurgeLabel[];
  total: number;
  capped: boolean;
}

export interface LabelPurgeResult {
  trashed: number;
  failed: number;
  error?: string;
}
