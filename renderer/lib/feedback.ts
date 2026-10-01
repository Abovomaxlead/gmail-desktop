// The one limit both sides of the feedback panel have to agree on.
//
// It lives here rather than in electron/ because the panel is the side that has to stop the
// typing, and main is allowed to read from renderer/lib while the reverse is not.


//===========================
// Constants
//===========================

/** How much of a message a mail wants to carry: the body travels to Gmail as a URL. */
export const MESSAGE_CHARS = 4000;
