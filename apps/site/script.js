/* Pinpoint — the only runtime logic on this page.
   1. Show a clear "render pending" note when the demo mp4 is not there yet.
   2. Keep the lens mock readable if a font fails (no JS needed, CSS handles it).
*/
(function () {
  "use strict";

  var shell = document.querySelector("[data-video]");
  if (!shell) return;

  var video = shell.querySelector("video");
  var source = video && video.querySelector("source");
  var note = shell.querySelector(".video-note");
  var settled = false;

  if (!video || !source) return;

  function missing() {
    if (settled) return;
    settled = true;
    shell.classList.add("is-missing");
    video.removeAttribute("controls");
    if (note) note.hidden = false;
  }

  video.addEventListener("loadedmetadata", function () {
    settled = true;
  });
  source.addEventListener("error", missing);

  /* preload="none" means the browser may never touch the file until play,
     so probe once. A missing file is the expected state until the render lands. */
  fetch(source.src, { method: "HEAD", cache: "no-store" })
    .then(function (res) {
      if (!res.ok) missing();
    })
    .catch(missing);
})();
