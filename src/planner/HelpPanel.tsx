export function HelpPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal help" onClick={(e) => e.stopPropagation()}>
        <div className="hstack">
          <h2 className="grow">How the numbers work</h2>
          <button onClick={onClose}>Close</button>
        </div>
        <h3>Room and coordinates</h3>
        <p>
          The room is a top-down trapezoid. <code>x</code> runs across the room (positive = house right), <code>y</code> runs from the stage edge (0) to
          the back wall, and height is measured from the floor. Walls are vertical. Each wall's elevation is drawn as you would see it standing inside the
          room facing it, so on the right wall the stage end is on the left and on the left wall the stage end is on the right.
        </p>
        <h3>Image footprint (frustum onto the wall)</h3>
        <p>
          The lens points along <code>forward = (sin pan · cos tilt, −cos pan · cos tilt, sin tilt)</code>. One foot in front of the lens the image is{" "}
          <code>1 ÷ throw ratio</code> feet wide and <code>width × (resolution height ÷ resolution width)</code> tall, moved by the lens shift
          (shift % × image size). For each image corner, the ray from the lens is intersected with the wall plane:
        </p>
        <p>
          <code>t = n · (wall point − lens) ÷ (n · ray)</code>, <code>hit = lens + t · ray</code>
        </p>
        <p>
          where <code>n</code> is the wall's inward normal. The four hits give the real, keystoned footprint. A flat wall maps the image through a perspective
          transform (homography), which is also how the Player's starting warp is calculated.
        </p>
        <h3>Brightness (foot-lamberts)</h3>
        <p>
          Average: <code>fL = lumens × gain × derate ÷ image area (ft²)</code>. Example: 8,000 lm × 0.8 gain × 0.8 derate ÷ 512 ft² = 10 fL.
        </p>
        <p>
          The heat map splits the image into a 32 × 20 grid. Each cell receives an equal share of the lumens, and its area on the wall is measured exactly, so
          cells that hit the wall at a steep angle or further away are larger and dimmer. That is the angle-of-incidence and distance correction. Green ≥ 8 fL,
          yellow 5–8 fL, red &lt; 5 fL (editable).
        </p>
        <h3>Sharpness (pixels per inch)</h3>
        <p>
          For each cell, <code>ppi = √(pixels in the cell ÷ cell area in square inches)</code>. Example: 1920 pixels across a 10 ft (120 in) wide image = 16
          ppi. The far end of an oblique image has fewer pixels per inch, so it looks softer.
        </p>
        <h3>Shadows</h3>
        <p>
          For the centre of each cell, the straight beam from the lens to the wall is sampled at 64 points. If any sample is inside the seating outline and
          below head height, that part of the image can be blocked by the audience. Seated (default 4 ft) and standing (default 6 ft) are checked separately.
        </p>
        <h3>Blend overlap and obstructions</h3>
        <p>
          Two footprints on the same wall are intersected (polygon clipping, both are convex). Overlap width is the horizontal extent of the shared area along
          the wall, and the percentage is shared area ÷ each projector's on-wall area. Any footprint that intersects a “never project here” rectangle is
          flagged; the Player masks those rectangles to black (with a 3 in safety margin).
        </p>
        <h3>Assumptions</h3>
        <ul>
          <li>Walls are flat and vertical, the floor is level (no rake), and the projector's light is spread evenly across its image.</li>
          <li>Wall gain treats the surface as matte. Real fL also depends on viewing angle, so use the numbers to compare options, not as a guarantee.</li>
          <li>Throw ratio is distance ÷ image width measured square-on. Check your lens's manual for its exact range.</li>
        </ul>
      </div>
    </div>
  );
}
