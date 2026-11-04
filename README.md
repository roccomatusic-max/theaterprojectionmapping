# Matilda Projection

A desktop app for projection-mapping the **side walls** of the auditorium (not the stage) for *Matilda the Musical JR*. It has two parts:

- **Planner**: model the room and the projectors, and see what each projector will cover, how bright and sharp it will be, and where audience shadows will fall, before you hang anything.
- **Player**: run the show. It sends content to each projector, warps and blends it onto the angled walls, blacks out exit signs and other obstructions, and fires cues with a GO button.

The show is built for **one computer per side wall**, connected over the network to a **booth computer** that runs the cue list. All the computers follow one **master clock**, so both walls change on the same frame. A single computer driving every projector also works.

Contents: [Install](#1-install) · [Run](#2-run-it) · [Plan the venue](#3-plan-a-new-venue) · [Set up the computers](#4-set-up-the-computers-and-projectors) · [Align and blend](#5-align-and-blend-the-projectors) · [Build the cue list](#6-build-the-cue-list) · [Run a show](#7-run-a-show) · [How the numbers work](#how-the-numbers-work) · [Troubleshooting](#troubleshooting) · [For developers](#for-developers)

---

## 1. Install

You do this once on **every** computer (the booth and each side-wall computer).

1. **Install Node.js.** Go to <https://nodejs.org>, click the big **LTS** download button, open the file you downloaded, and click **Next** / **Continue** through the installer, leaving the defaults alone.
2. **Download this app.** On the GitHub page for this repository, click the green **Code** button, then **Download ZIP**. Find the ZIP in your Downloads folder, then right-click it and choose **Extract All…** (Windows) or double-click it (Mac). Move the extracted folder somewhere easy to find, for example `Documents\matilda-projection`.
3. **Open a terminal in that folder.**
   - Windows: open the folder in File Explorer, click in the address bar at the top, type `cmd`, and press **Enter**. A black window opens in that folder.
   - Mac: open **Terminal** (press Cmd+Space, type `Terminal`, press Enter), type `cd ` (with a space after it), drag the folder from Finder into the Terminal window, and press **Enter**.
4. **Install the app's parts.** In the terminal, type the following and press **Enter**:
   ```
   npm install
   ```
   Wait until it finishes (a minute or two). Warnings in yellow are fine.

## 2. Run it

In the terminal from step 1.3, type the following and press **Enter**:

```
npm start
```

The app builds itself (a few seconds) and opens. The first time, it opens as the **booth computer**.

To make a computer a **side-wall computer**, open the app, go to **Player: Setup**, open **This computer's role** at the bottom of the left panel, and click **Make this a side-wall computer**. It restarts and shows a simple status screen with its IP address. It remembers this choice, so next time `npm start` opens it straight into side-wall mode. To switch back, click **Make this the booth computer instead** on that screen.

> Optional: `npm run dist:win` (on Windows) or `npm run dist:mac` (on a Mac) builds an installer in the `release` folder, so you can double-click the app instead of using the terminal.

## 3. Plan a new venue

Open the **Planner** tab. Everything on the left can be edited. Lengths accept `12' 6"`, `12ft 6in`, `12.5` (feet), or metric like `3.8m` or `380cm`. Switch **Units** to *Metric* to see everything in metres.

1. **Room.** Enter the **front width** (wall to wall at the stage edge), **back width**, **length** (stage edge to back wall) and **wall height**. If a wall isn't a straight line between those points, tick **Adjust … wall ends by hand** and type where each end really is.
2. **Audience.** Enter the seated head height (default 4 ft) and standing head height (default 6 ft). Edit the seating outline's corners, or click **Fit to room**.
3. **Wall surface and light loss.** Gain is 0.8 for a painted wall. Derate (0.8) allows for an aging lamp and dust.
4. **Projectors.** The plan starts with four 8,000-lumen projectors, two stacked in each back corner, cross-shooting to the opposite wall (front half and back half). For each one, click its name to open it and set its position, mount height, pan / tilt / roll, lumens, resolution, throw ratio and zoom range, lens shift and target wall. **Cover front half** / **Cover back half** aim and zoom it for you. Use **⧉** to duplicate and **✕** to remove.
5. **Obstructions.** Add every exit sign, door, speaker and sconce. “From stage end” is the distance along the wall from its stage end to the edge of the item nearest the stage. Exit signs are always **never project here**.
6. **Check the results.** Pick a heat map (Brightness, Sharpness, Shadows seated or standing) above the views. The **Results** table lists throw distance, image size, brightness range, sharpness, shadow risk, and warnings such as “covers Exit sign”. Hatched areas on the wall views are where two projectors overlap, which is where they will be blended.
7. **Save.** Click **Save** to keep the plan as a file. The app also keeps your latest plan on that computer automatically.
8. **Print it.** **Export wall summary (PDF)** makes one page per wall with the footprint size, brightness, throw distance, mount height and settings for every projector. Take it up the ladder when you hang them.
9. **Send to Player →** copies the walls, the obstruction masks and one output per projector into the Player, with each projector's warp roughed in from the math.

## 4. Set up the computers and projectors

**Network:** plug every computer into the same wired network switch. Don't use Wi-Fi for the show. Fixed (static) IP addresses are best, so the addresses never change between rehearsal and show night.

**Media:** the booth computer keeps all videos and images in its **media folder** (Player: Setup → Media folder → Open folder). When you choose a file for a cue, the app copies it into that folder. Before each show, copy the whole folder to each side-wall computer, and on each side-wall computer point its **Media folder** setting at the copy. Only cues travel over the network, never video. If a side computer is missing a file, the booth shows a red warning naming the file and that computer.

On the **booth computer**, open **Player: Setup**:

1. Under **Side-wall computers**, click **+ Add** for each side computer. Type in the IP address shown in large text on that computer's screen. It shows **connected** in green once it's talking.
2. In the **Outputs** table, set each projector's **Computer** (this computer, or one of the side computers), then its **Display**: the list shows every screen that computer can see. Choose **Window on the main screen (testing)** to rehearse without projectors.
3. Use the test-pattern buttons (**Grid**, **Crosshatch**, **Colour bars**, **White**, **Black**, **Name**) to check each projector. **Name** shows each projector's name in big letters, so you can tell which is which. **Show content** switches back.

Output windows open black, with no frame and no mouse pointer, and **Escape never closes them**. They close only when you quit the app.

## 5. Align and blend the projectors

Open **Player: Align** and pick an output from the list at the top. Put the **Grid** test pattern on it: its lines are a real 1-foot grid on the wall, numbered every 5 feet, so they should match up across the two projectors on a wall.

1. **Corner pin.** Click **Corner pin**. Click a corner handle in the preview (Shift-click to pick several), then drag it, or nudge it with the arrow keys: one press moves 1 pixel (change **Fine step** for smaller moves), and Shift + arrow moves 10 pixels. Watch the real wall while you nudge.
2. **Mesh.** If the wall isn't perfectly flat, click **Mesh**, choose how many points across and down (2 to 10 each), and nudge individual points. The picture bends smoothly between points.
3. **Edge blend.** Where two projectors overlap, set the same blend width (in feet) on the edges that touch: for example the front projector's **right** edge and the back projector's **left** edge on the right wall. Sending from the Planner fills these in for you. Curve 2 and gamma 2.2 suit most projectors. Use **White** to check the seam and adjust until you can't see a bright or dark band.
4. **Brightness and colour match.** If one projector looks brighter or a different colour, turn its **Brightness** or **Red / Green / Blue** down until the two match on **White**.
5. **Masks.** Exit signs and the other obstructions from the Planner are already blacked out under **Wall masks** (exit-sign masks can't be switched off). To black out anything else, click **Output masks** → **New mask**, click points around it on the preview, then click **Finish**.

**Reset from Planner** puts an output's corners and mesh back to the calculated values. **Full frame** stretches the picture to the whole projector frame.

## 6. Build the cue list

Open **Player: Show**. A new show starts with three example cues (“Example: preshow”, “Example: scene look”, “Example: blackout”). Replace them with your own:

- **+ Add cue** adds a cue after the selected one. Select a cue to edit it in the panel underneath.
- **Walls:** which walls the cue changes. A cue for one wall leaves the other wall alone.
- **Media:** *Still image*, *Video*, *Solid colour*, or *Black (fade out)*. **Choose file…** picks a file and copies it into the media folder.
- **When the video ends:** *Loop*, *Hold last frame*, or *Play once, then black*.
- **Fit to wall:** each wall is one big picture. *Fill the wall* crops the edges, *Fit inside the wall* adds black bars, *Stretch* distorts it to fit. For the best result, make images at the wall's shape (Setup shows a suggested pixel size).
- **Fade in / out:** fade in is how long this cue's look takes to appear. Fade out is how long the look it replaces takes to disappear.
- **Auto-follow:** fire the next cue automatically, a set number of seconds after this one.

Everything saves automatically after every change, and the last 10 versions are kept (**Setup → Show file → Backups…** to go back to one).

**Video formats:** use **MP4 (H.264)**. ProRes and HAP files won't play in this app. Convert them first with the free HandBrake (choose the “Fast 1080p30” preset). Videos play silently; run sound from the sound desk.

## 7. Run a show

1. Start the side-wall computers first, then the booth computer.
2. On **Player: Show**, check that the **master clock** panel says every wall computer is **locked** and the walls are **in step**, and that there are no red warnings.
3. Turn on **Show mode** (top right). It locks every setting, so nobody can move a warp or change a cue by accident. GO, Back and Panic still work.
4. Run the show:
   - **GO** (or the **Space** bar) fires the cue marked **next**. Double-click any cue to make it next instead, or press **▶** on a row to fire it immediately.
   - **Back** (or **Backspace**) returns to the previous cue's look.
   - **PANIC / BLACKOUT** (or **Esc**) makes every projector black immediately. Press **GO** to carry on from where you were.
   - **Fade all out (3 s)** fades everything to black gently.
5. The previews show what each projector is actually showing, updated about once a second, with frames per second and dropped frames underneath.

If the network drops during the show, the side walls keep showing their last look, and the booth reconnects automatically when the cable is back.

**OSC (optional):** in **Setup → OSC remote control**, tick the box to let a lighting console or QLab send `/go`, `/back`, `/blackout` and `/cue/5` (or `/cue` with the number as an argument) over UDP, port 8000 by default.

---

## How the numbers work

All lengths are stored in feet.

**Coordinates.** Seen from above, the room is a trapezoid. `x` runs across the room (positive = house right), `y` runs from the stage edge (0) to the back wall, and height is measured up from the floor. Walls are vertical planes. Each wall is drawn and laid out as you see it standing inside the room facing it, so on the right wall the stage end is on the left, and on the left wall the stage end is on the right.

**Projector frustum.** With pan *p* (0 = facing the stage, +90° = facing house right) and tilt *t* (positive = up):

```
forward = (sin p · cos t, −cos p · cos t, sin t)
right   = (cos p, sin p, 0)            (then rotated by roll about forward)
up      = forward × right
```

One foot in front of the lens the image is `w = 1 / throw ratio` wide and `h = w × (res height / res width)` tall. Lens shift moves the image by `shift% × w` (horizontal) or `shift% × h` (vertical). The ray through image point (u, v) is `forward + x·right + y·up`.

**Footprint (ray–plane intersection).** For a wall with point *A* on it and inward normal *n*:

```
t   = n · (A − lens) / (n · ray)       (the ray must head towards the wall: n · ray < 0)
hit = lens + t · ray
```

The four image corners give the real, keystoned footprint. Projecting a flat image onto a flat wall is a perspective transform (homography), so the whole image maps exactly through the 4-corner homography. The Player uses the inverse of that to rough in each output's warp.

**Brightness.** Average luminance in foot-lamberts:

```
fL = lumens × gain × derate ÷ image area (ft²)
e.g. 8000 lm × 0.8 × 0.8 ÷ 512 ft² = 10 fL
```

For the heat map the image is split into 32 × 20 cells. Each cell gets an equal share of the lumens (the projector spreads its light evenly over its pixels), and its true area on the wall is measured. Cells that land further away or at a steeper angle are larger, so they come out dimmer. That is the angle-of-incidence and distance correction. Bands: green ≥ 8 fL, yellow 5–8 fL, red < 5 fL (all editable).

**Sharpness.** For each cell, `pixels per inch = √(pixels in cell ÷ cell area in in²)`. Check: 1920 pixels across a 10 ft (120 in) wide image = 16 ppi.

**Shadows.** For each cell centre, the straight beam from the lens to the wall is sampled at 64 points. If any sample is inside the seating outline and lower than head height, an audience member can block that part of the image. Seated (4 ft) and standing (6 ft) are checked separately.

**Blend overlap.** Two footprints on the same wall are intersected by polygon clipping (both are convex). Overlap width is the horizontal extent of the shared area. The percentage is the shared area divided by each projector's on-wall area.

**Obstructions.** Any footprint that intersects a “never project here” rectangle is flagged, and the Player blacks out that rectangle plus a 3-inch safety margin.

**Edge blend (Player).** Across a blend of width *W* feet, a point *d* feet in from the edge gets `f = curve(d / W)`, where `curve(x) = ½(2x)^c` for x < ½ and `1 − ½(2(1−x))^c` above (c = curve setting). The curve is symmetric, so two overlapping projectors' ramps add up to exactly 1 in light. Pixels are gamma-encoded, so the value sent is `f^(1/γ)`. Both projectors' ramps are defined on the same strip of wall, which is why content lines up across the seam.

**Sync.** Cues are scheduled about 150 ms ahead on the master clock (“start at time T”), so both walls start together. Fades are worked out from master time on every frame, and videos are nudged up to 5% faster or slower (or re-seeked if more than 250 ms out) to stay on the master timeline.

**Assumptions.** Walls are flat and vertical, the floor is level (no rake), the projector's light is spread evenly across its image, and the wall is matte (gain applies equally from every seat). Use the numbers to compare options; they are estimates, not guarantees.

---

## Troubleshooting

- **A side computer says “not connected”.** Check that both computers are on the same wired network, that the IP address typed on the booth matches the one shown on the side computer, and that the firewall allows the app. Windows asks the first time: click **Allow access**.
- **“Missing media” warning.** That computer's media folder doesn't have the file. Copy the media folder across again, or point **Media folder** at the right place.
- **An output is black.** Check the Display column in Setup (it says “Display not found” if the projector is unplugged or off), then try the **Name** test pattern.
- **Low fps or dropped frames.** Use H.264 MP4s at 1080p or less, and close other programs. Each side computer needs a real graphics card, not a USB-to-HDMI adapter.

## For developers

- Electron + TypeScript, React UI, WebGL output renderer. `npm run typecheck`, `npm test` (vitest), `npm run build`.
- `src/shared/`: pure logic, shared by all processes: projection math (`geometry.ts`), homography and warp (`homography.ts`, `warp.ts`), cue engine (`cueEngine.ts`), Planner → Player export (`planToShow.ts`), OSC parsing, the clock interfaces.
- `electron/`: main process: operator and side-wall roles (`main.ts`), output windows (`outputs.ts`), show autosave and backups (`showStore.ts`), network link (`net/link.ts`, TCP + newline-delimited JSON on port 47800), master clock (`clock/`), OSC (`osc.ts`).
- `src/planner/`, `src/player/`, `src/index/` (booth window), `src/node/` (side-wall window), `src/output/` (projector output renderer).
- `npm run node` starts a side-wall computer from the command line; use `npm run node -- --separate-profile` to run one next to the booth on the same machine for testing (use `127.0.0.1` as its address).
