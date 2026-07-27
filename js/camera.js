/* ==========================================================================
   camera.js — turning the webcam on and off.

   This is the only file that talks to your actual camera hardware.
   Everything else just receives a <video> element that happens to be
   showing live pictures.
   ========================================================================== */

/**
 * Ask the browser for the webcam and start playing it into a <video>.
 *
 * The browser will pop up its own "Allow camera?" prompt. We cannot skip
 * that or style it — it belongs to the browser on purpose, so a website
 * can never secretly switch your camera on.
 *
 * @param {HTMLVideoElement} video  the element to show the camera in
 * @returns {Promise<MediaStream>}  the live stream (keep it, so we can stop it)
 */
export async function startCamera(video) {
  // "ideal" means: please try for this, but don't fail if you can't.
  // A laptop webcam that only does 720p will just give us 720p.
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      width:  { ideal: 1280 },
      height: { ideal: 960 },
      facingMode: "user",   // the front/selfie camera
    },
  });

  video.srcObject = stream;

  // The video element needs a moment before it knows how big the picture is.
  // We wait for that, otherwise our canvas would be sized 0 × 0.
  await new Promise((resolve) => {
    if (video.readyState >= 2) return resolve();
    video.onloadeddata = () => resolve();
  });

  await video.play();
  return stream;
}

/**
 * Turn the camera off properly.
 *
 * Stopping every "track" is what makes the little green camera light on your
 * laptop go out. Just hiding the video would leave the camera running.
 */
export function stopCamera(video, stream) {
  if (stream) {
    for (const track of stream.getTracks()) track.stop();
  }
  if (video) video.srcObject = null;
}

/**
 * Turn the browser's technical error into something a human can act on.
 */
export function describeCameraError(err) {
  switch (err && err.name) {
    case "NotAllowedError":
      return "You (or your browser) blocked camera access. Click the camera icon in the address bar and choose Allow, then try again.";
    case "NotFoundError":
      return "No camera found. Is one plugged in and switched on?";
    case "NotReadableError":
      return "The camera is busy — another app (Zoom, Teams, OBS…) is probably using it. Close that app and try again.";
    case "SecurityError":
      return "Cameras only work on https:// pages or on localhost. Open the site over https.";
    default:
      return "Could not start the camera: " + (err && err.message ? err.message : String(err));
  }
}
