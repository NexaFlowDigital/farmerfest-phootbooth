/**
 * Farmer Fest Photobooth – Lewisville High School (Killough)
 *
 * Configuration for the front-end. Edit values here only.
 *
 *   GAS_POST_URL : Your Google Apps Script Web App URL (deployed as "Anyone can access")
 *                  Paste the new URL after deploying google-apps-script/Code.gs.
 *
 *   EVENT_NAME   : Shown on the photo strip + email.
 *   SCHOOL_NAME  : Shown on the photo strip + email.
 *   FROM_NAME    : Name your emails are sent "from" (in Gmail).
 *   REPLY_TO     : Reply-to email address.
 *
 *   FRAME_COUNT  : Number of overlay frames in assets/frames/ (frame_1.png ... frame_N.png)
 */
window.PHOTOBOOTH_CONFIG = {
  GAS_POST_URL: "https://script.google.com/macros/s/AKfycbx92ToglqNydn4izuW85MWz4yATSBvTc_pN7T0XckON46YvyEzP7RSCWX1H0lBEhZrm/exec",

  EVENT_NAME:   "Farmer Fest",
  SCHOOL_NAME:  "Lewisville High School • Killough",
  FROM_NAME:    "LHS Farmer Fest Photobooth",
  REPLY_TO:     "photobooth@nexaflowdigital.com",

  FRAME_COUNT:  8,

  /* Idle reset: after this many ms with no interaction on the result screen,
     return to the attract screen (mall-photobooth behavior). 0 = disabled. */
  IDLE_RESET_MS: 90000
};
