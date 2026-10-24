# Deployment paths: running this on hardware already in an ICU room

For the "how would this actually get deployed" question. Nothing here changes the build. The demo setup
(a laptop on the overbed table) is the realistic first deployment, not a stand-in for it.

Status of the claims: from team knowledge, not verified with any hospital or vendor as of 2026-10-24.
Check before putting a vendor name on a slide.

## What's in the room

| Hardware | Usable? | Why |
| --- | --- | --- |
| Bedside physiologic monitor (Philips IntelliVue, GE Carescape, Mindray) | No | Regulated, locked down, no app surface, no patient-facing camera. Faces the nurse. |
| Patient-engagement screen on an arm or wall TV (GetWellNetwork, pCare, Sonifi, Oneview) | Yes, via vendor | Android or Linux box with a vendor app platform; some have a camera. Closest thing to an app store at the bedside. |
| Workstation on wheels, bedside iPad (Epic MyChart Bedside) | Yes, today | Nurses already park these at the bed. This is how hospitals already run software at the bedside. |
| Virtual-sitter camera (care.ai, AvaSure, LookDeep) | Yes, later | An AI camera already pointed at the patient's face for fall and agitation monitoring. Our gaze and squint detection could run on that feed with no new hardware. |

## Path 1: laptop or tablet on the overbed table (now)

What we demo. Electron on a laptop, webcam centered above the screen, 50 to 70 cm from the face.
Needs: a stand or arm so the camera stays put, a nurse to run calibration (20 s), and room light on the face.
Nothing to convert.

## Path 2: patient-engagement platform (months)

Package the renderer as a web app for the vendor's platform. The pieces that move:

- Gaze and squint: MediaPipe Face Landmarker runs in any Chromium-based WebView, so `vision/` ports as is.
  Needs camera access from the vendor app, which not every platform grants.
- Replies, STT, TTS: already behind the conversation server over HTTP. The server moves to a hospital-hosted box;
  the screen only needs a URL.
- Keys stay on the server. The screen never holds one, same as now.
- Open question: whether the vendor's screen has a camera at eye level. Many are wall TVs with no camera, which rules
  them out for input but not for display.

## Path 3: virtual-sitter camera feed (later, the interesting one)

The camera already watches the patient. The sitter vendor exposes a video stream to the room's display system,
and our input module consumes it instead of a webcam. The patient looks at any screen in the room; the sitter camera
sees the eyes.

- Same `vision/` code, different `MediaStream` source. Calibration still needed per patient.
- Requires a vendor partnership and their consent to third-party processing of the feed. Not a weekend.
- Upside: zero new hardware, and the camera is already positioned and lit for the face.

## What stays the same on every path

- One camera, one patient, caregiver out of frame.
- Calibration per patient, no training.
- Replies from Claude via the server; the screen is thin.
- Keys never on the patient device.

## What we don't claim

- No "FDA-cleared" or "clinical" wording. This is a communication aid, not a medical device, on any path.
- No integration with the EHR or the physiologic monitor.
