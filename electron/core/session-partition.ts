// The Chromium session every Google view, window and fetch shares.
//
// It lives in a leaf module of its own rather than beside the runtime bindings, because the
// view manager needs it and runtime needs the view manager's types: putting the string in
// runtime.ts makes those two files import each other.
//
// One string, one declaration: a view opened in another partition is a second browser as far
// as Google is concerned, so it would be signed out while the rest of the app is not.


//===========================
// Constants
//===========================

export const SESSION_PARTITION = 'persist:google';
