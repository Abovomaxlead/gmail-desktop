// Which accounts lost their Gmail link, in renderer/lib so main, the preload bridge and the
// notice all read one declaration.
//
// Being on the list is the whole message: the token is gone, so moving mail stops until the
// account is connected again. There was a second reason once, for the relay push that no
// longer exists, which is why the entry carries nothing but the address.


//===========================
// Types
//===========================

export interface ReconnectAccount {
  email: string;
}
