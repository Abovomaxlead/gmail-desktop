// The payload the "add a delegated mailbox" picker is drawn from, shared between main, the
// overlay page and the preload bridge.
//
// It arrives twice: once the moment the panel opens, with `scanning` set and no candidates,
// and once when the relay has answered. Asking Google who may reach what takes a second or
// two, and a panel that appears empty for that second reads as "there is nothing".
//
// `answered` is what tells an empty list apart from a list nobody could produce. No account
// with a token, a relay that is down, a refusal -- all of those come back empty as well, and
// telling someone "je hebt niets om toe te voegen" when the truth is "ik kon het niet
// navragen" is how a person concludes the feature is broken.


//===========================
// Types
//===========================

export interface DelegatedPickerAsk {
  /** True while the relay is still being asked; the candidates are not final yet */
  scanning: boolean;
  /** Addresses that may be added, lowercased and sorted */
  candidates: string[];
  /** Whether at least one requester's ask of the relay came back */
  answered: boolean;
  locale: 'en' | 'nl';
  reneMode: boolean;
}
