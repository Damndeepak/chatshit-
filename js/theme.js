/* Mirror the device appearance preference throughout the site. */
(function () {
  "use strict";
  const preference = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  function updateTheme() {
    const dark = Boolean(preference && preference.matches);
    if (document.body) document.body.classList.toggle("dark", dark);
    const themeColor = document.querySelector("#appThemeColor");
    if (themeColor) themeColor.content = dark ? "#211e2b" : "#f7f5fb";
  }

  updateTheme();
  if (preference && preference.addEventListener) preference.addEventListener("change", updateTheme);
  else if (preference && preference.addListener) preference.addListener(updateTheme);
})();
