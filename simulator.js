// --- Pistol Sighting Simulator (Tireur.org) ---

const canvas = document.getElementById("pistolCanvas");
const ctx = canvas.getContext("2d");

const W = canvas.width;
const H = canvas.height;
const split = W / 2;
const panelH = 60; // Bottom status bar inside canvas
const cx = W / 4;  // Center of left screen
const cy = (H - panelH) / 2; // Center of left screen viewport
const tx = W * 0.75; // Center of right screen (target)
const ty = cy;

// --- Physical constants & scales ---
const L_SIIGHT_RADIUS_MM = 220; // mm
const targetCenterY = 250; // Fixed target center height in the sights viewport

// Target parameters
const TARGETS = {
  "10m": {
    name: "10m Pistolet",
    distance_mm: 10000,
    ring_spacing_mm: 8.0,
    rings: [
      { num: 10, r: 11.5 / 2 },
      { num: 9, r: 27.5 / 2 },
      { num: 8, r: 43.5 / 2 },
      { num: 7, r: 59.5 / 2 }, // Edge of black area
      { num: 6, r: 75.5 / 2 },
      { num: 5, r: 91.5 / 2 },
      { num: 4, r: 107.5 / 2 },
      { num: 3, r: 123.5 / 2 },
      { num: 2, r: 139.5 / 2 },
      { num: 1, r: 155.5 / 2 }
    ],
    mouche_r: 5.0 / 2,
    black_r: 59.5 / 2,
    card_size: 170,
    scale_left: 1.8,   // px/mm
    scale_right: 2.4,  // px/mm
    bullet_r_mm: 4.5 / 2, // 4.5 mm pellet
    muzzle_velocity_mps: 175, // typical 10m air pistol pellet
    wind_factor: 0.5,  // mm shift per m/s
    click_value_mm: 1.0 // 0.1 mrad click -> 1.0 mm at 10m
  },
  "25m": {
    name: "25m Pistolet Précision",
    distance_mm: 25000,
    ring_spacing_mm: 25.0,
    rings: [
      { num: 10, r: 50.0 / 2 },
      { num: 9, r: 100.0 / 2 },
      { num: 8, r: 150.0 / 2 },
      { num: 7, r: 200.0 / 2 }, // Edge of black area
      { num: 6, r: 250.0 / 2 },
      { num: 5, r: 300.0 / 2 },
      { num: 4, r: 350.0 / 2 },
      { num: 3, r: 400.0 / 2 },
      { num: 2, r: 450.0 / 2 },
      { num: 1, r: 500.0 / 2 }
    ],
    mouche_r: 25.0 / 2,
    black_r: 200.0 / 2,
    card_size: 550,
    scale_left: 0.55,   // px/mm
    scale_right: 0.8,   // px/mm
    bullet_r_mm: 5.6 / 2, // 5.6 mm (.22 LR)
    muzzle_velocity_mps: 330, // typical .22 LR sport pistol
    wind_factor: 1.5,
    click_value_mm: 2.5 // same 0.1 mrad click -> 2.5 mm at 25m
  }
};

// --- State Variables ---
let targetKey = "10m";
let holdType = "6oclock"; // "6oclock" or "center"
let focusType = "front";  // "front", "target", "rear"
let wobblePreset = "none";
let wobbleAmp = 0.0; // scale factor
let alignErrX = 0.0; // mm misalignment of front post
let alignErrY = 0.0; // mm misalignment of front post
let cantDeg = 0.0;   // degrees of tilt
let clicksX = 0;     // rear sight windage clicks
let clicksY = 0;     // rear sight elevation clicks
let windSpeed = 0.0; // m/s
let windDirDeg = 90; // degrees (90 = 3 o'clock / crosswind from right)

// Dimensions of sights (mm)
let frontPostWidth = 3.0; // mm
let rearNotchWidth = 3.5; // mm
let rearNotchDepth = 2.0; // mm

// Real-time aiming state (in mm on target)
let aimX = 0.0;
let aimY = 0.0;
let mouseAimX = 0.0;
const defaultTarget = TARGETS[targetKey];
let mouseAimY = (holdType === "6oclock") ? -(defaultTarget.black_r + 6.0) : 0.0;

// Wobble offsets (in mm on target)
let wobbleX = 0.0;
let wobbleY = 0.0;
let wobbleTime = 0.0;

// Sighting dimensions on left screen
const PX_PER_MM_SIGHT = 25.0; // pixel scale for sight drawing

// Shots history
let shots = [];

// Input handling
let canvasFocused = false;
canvas.tabIndex = 0;
canvas.style.outline = "none";

// Event Listeners for Canvas Focus & Mouse
canvas.addEventListener("mouseenter", () => { canvasFocused = true; });
canvas.addEventListener("mouseleave", () => { canvasFocused = false; });
canvas.addEventListener("focus", () => { canvasFocused = true; });
canvas.addEventListener("blur", () => { canvasFocused = false; });

canvas.addEventListener("mousemove", (e) => {
  const rect = canvas.getBoundingClientRect();
  const mouseX = (e.clientX - rect.left) * (W / rect.width);
  const mouseY = (e.clientY - rect.top) * (H / rect.height);
  
  if (mouseX < split) {
    const activeTarget = TARGETS[targetKey];
    // Mouse X relative to target center cx (positive = sights point right of target center)
    mouseAimX = (mouseX - cx) / activeTarget.scale_left;
    // Mouse Y relative to target center targetCenterY (positive = sights point above target center)
    mouseAimY = (targetCenterY - mouseY) / activeTarget.scale_left;
  }
});

// Touch controls support
canvas.addEventListener("touchmove", (e) => {
  if (e.touches.length > 0) {
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches[0];
    const touchX = (touch.clientX - rect.left) * (W / rect.width);
    const touchY = (touch.clientY - rect.top) * (H / rect.height);
    
    if (touchX < split) {
      e.preventDefault();
      const activeTarget = TARGETS[targetKey];
      mouseAimX = (touchX - cx) / activeTarget.scale_left;
      mouseAimY = (targetCenterY - touchY) / activeTarget.scale_left;
    }
  }
}, { passive: false });

// Keyboard Controls (WASD for micro sight alignment shifts)
document.addEventListener("keydown", (e) => {
  if (!canvasFocused) return;
  
  let step = 0.02; // mm step
  if (e.shiftKey) step = 0.05;
  
  const key = e.key.toLowerCase();
  
  if (key === "a") {
    alignErrX = Math.max(-0.8, alignErrX - step);
    syncSliders();
  }
  if (key === "d") {
    alignErrX = Math.min(0.8, alignErrX + step);
    syncSliders();
  }
  if (key === "w") {
    alignErrY = Math.max(-0.8, alignErrY - step);
    syncSliders();
  }
  if (key === "s") {
    alignErrY = Math.min(0.8, alignErrY + step);
    syncSliders();
  }
  
  if (key === "z") {
    cantDeg = Math.max(-15, cantDeg - 0.5);
    syncSliders();
  }
  if (key === "x") {
    cantDeg = Math.min(15, cantDeg + 0.5);
    syncSliders();
  }
  
  if (key === "r") {
    resetSights();
  }
  
  if (e.key === " ") {
    e.preventDefault();
    fireShot();
  }
});

// --- Main Equations ---

function updateWobble() {
  if (wobbleAmp === 0) {
    wobbleX = 0;
    wobbleY = 0;
    return;
  }
  
  wobbleTime += 0.025;
  const baseAmp = wobbleAmp * 2.0; 
  wobbleX = baseAmp * (Math.sin(wobbleTime * 1.1) * 0.6 + Math.sin(wobbleTime * 0.35) * 0.35 + Math.cos(wobbleTime * 2.1) * 0.05);
  wobbleY = baseAmp * (Math.cos(wobbleTime * 0.9) * 0.5 + Math.sin(wobbleTime * 0.45) * 0.4 + Math.sin(wobbleTime * 1.8) * 0.1);
}

function computeState() {
  const activeTarget = TARGETS[targetKey];
  
  // Aiming position (mm relative to target center)
  aimX = mouseAimX + wobbleX;
  aimY = mouseAimY + wobbleY;
  
  // Alignment error translation to target displacement (mm)
  const distScale = activeTarget.distance_mm / L_SIIGHT_RADIUS_MM;
  const alignmentShiftX = alignErrX * distScale;
  const alignmentShiftY = alignErrY * distScale;
  
  // Cant tilt effect
  const cantRad = (cantDeg * Math.PI) / 180;
  const cosCant = Math.cos(cantRad);
  const sinCant = Math.sin(cantRad);
  
  const alignedX = alignmentShiftX * cosCant - alignmentShiftY * sinCant;
  const alignedY = alignmentShiftX * sinCant + alignmentShiftY * cosCant;
  
  // Gravity & Cant offsets
  const sightHeightOffset = 45.0; // mm
  const flightTime = (activeTarget.distance_mm / 1000) / activeTarget.muzzle_velocity_mps; // s
  const totalZeroDrop = 0.5 * 9.81 * flightTime * flightTime * 1000; // mm
  const cantDeflectX = (sightHeightOffset + totalZeroDrop) * Math.sin(cantRad);
  const cantDeflectY = (sightHeightOffset + totalZeroDrop) * (1 - Math.cos(cantRad));
  
  // Wind deflection.
  // windDirDeg = direction the wind comes FROM (clock convention, 90° = from the right).
  // The bullet is pushed in the opposite direction (wind from the right -> impact to the left).
  // Only the crosswind (lateral) component matters; a head/tail wind has negligible
  // vertical effect at pistol distances, so there is no vertical wind term.
  const windDirRad = (windDirDeg * Math.PI) / 180;
  const windX = -windSpeed * activeTarget.wind_factor * Math.sin(windDirRad);
  const windY = 0.0;
  
  // Clicks adjustment (moves the zero)
  const clickX_mm = clicksX * activeTarget.click_value_mm;
  const clickY_mm = clicksY * activeTarget.click_value_mm;
  
  // Gun Zero setup based on intended hold type
  const holdOffset_zero = (holdType === "6oclock") ? (activeTarget.black_r + 6.0) : 0.0;
  
  // Total impact point on target (mm from center)
  const impactX = aimX + alignedX + cantDeflectX + windX + clickX_mm;
  const impactY = aimY + alignedY - cantDeflectY + windY + holdOffset_zero + clickY_mm;
  
  return {
    aimX: aimX,
    aimY: aimY,
    impactX: impactX,
    impactY: impactY
  };
}

function calculateScore(x_mm, y_mm) {
  const activeTarget = TARGETS[targetKey];
  const dist = Math.hypot(x_mm, y_mm);
  
  if (targetKey === "10m") {
    if (dist <= 5.0 / 2) return { score: 10.9 - (dist / (5.0/2)) * 0.3, isMouche: true };
    if (dist <= 11.5 / 2) return { score: 10.6 - ((dist - 2.5) / 3.25) * 0.6, isMouche: false };
    if (dist <= 155.5 / 2) {
      const ringIndex = Math.floor((dist - 5.75) / 8.0);
      const ringStart = 5.75 + ringIndex * 8.0;
      const fraction = (dist - ringStart) / 8.0;
      return { score: Math.max(1.0, 9.9 - ringIndex - fraction), isMouche: false };
    }
  } else {
    if (dist <= 25.0 / 2) return { score: 10.9 - (dist / (25.0/2)) * 0.3, isMouche: true };
    if (dist <= 50.0 / 2) return { score: 10.6 - ((dist - 12.5) / 12.5) * 0.6, isMouche: false };
    if (dist <= 500.0 / 2) {
      const ringIndex = Math.floor((dist - 25.0) / 25.0);
      const ringStart = 25.0 + ringIndex * 25.0;
      const fraction = (dist - ringStart) / 25.0;
      return { score: Math.max(1.0, 9.9 - ringIndex - fraction), isMouche: false };
    }
  }
  return { score: 0.0, isMouche: false };
}

// --- Drawing Routines ---

function drawLeftViewport(state) {
  const activeTarget = TARGETS[targetKey];
  
  // 1. Background Frame
  ctx.fillStyle = "#1e252b";
  ctx.fillRect(0, 0, split, H - panelH);
  
  ctx.save();
  ctx.beginPath();
  ctx.rect(2, 2, split - 4, H - panelH - 4);
  ctx.clip();
  
  // Draw range wall background
  ctx.fillStyle = "#dce1e5";
  ctx.fillRect(0, 0, split, H - panelH);
  
  // 2. Draw Target in Background (with focus blur, fixed at center targetCenterY)
  const focusBlur = getBlurFilters();
  ctx.filter = `blur(${focusBlur.target}px)`;
  
  const targetCardSizePx = activeTarget.card_size * activeTarget.scale_left;
  const targetX = cx;
  const targetY = targetCenterY;
  
  ctx.fillStyle = "#e6d3a3"; // cardboard
  ctx.fillRect(targetX - targetCardSizePx/2, targetY - targetCardSizePx/2, targetCardSizePx, targetCardSizePx);
  ctx.strokeStyle = "#c8b88d";
  ctx.lineWidth = 1;
  ctx.strokeRect(targetX - targetCardSizePx/2, targetY - targetCardSizePx/2, targetCardSizePx, targetCardSizePx);
  
  // Black aiming mark
  ctx.fillStyle = "#111";
  ctx.beginPath();
  ctx.arc(targetX, targetY, activeTarget.black_r * activeTarget.scale_left, 0, Math.PI * 2);
  ctx.fill();
  
  // 3. Draw Sights (moving with the shooter's aim)
  ctx.filter = "none";
  
  // Calculate dynamic screen coordinates for sights notch
  const sightsX = cx + (state.aimX * activeTarget.scale_left);
  const sightsY = targetCenterY - (state.aimY * activeTarget.scale_left);
  
  // Cant transformation matrix for sights
  ctx.save();
  ctx.translate(sightsX, sightsY);
  ctx.rotate((cantDeg * Math.PI) / 180);
  
  // Draw Front Post (underneath rear sight, so rear sight blocks it)
  ctx.save();
  ctx.filter = `blur(${focusBlur.front}px)`;
  
  const postWidthPx = frontPostWidth * PX_PER_MM_SIGHT;
  const postX = alignErrX * PX_PER_MM_SIGHT;
  const postY = alignErrY * PX_PER_MM_SIGHT;
  
  ctx.fillStyle = "#1e1e22";
  ctx.fillRect(postX - postWidthPx/2, postY, postWidthPx, 120);
  
  // Top highlight on front post
  ctx.fillStyle = "#3a3a40";
  ctx.fillRect(postX - postWidthPx/2, postY, postWidthPx, 2);
  ctx.restore();
  
  // Draw Rear Sight Mask & Slide (blocks front sight)
  ctx.save();
  ctx.filter = `blur(${focusBlur.rear}px)`;
  
  const notchWidthPx = rearNotchWidth * PX_PER_MM_SIGHT;
  const notchDepthPx = rearNotchDepth * PX_PER_MM_SIGHT;
  const bladeWidthPx = 280; // Width of rear sight blade
  const bladeHeightPx = 80;
  
  ctx.fillStyle = "#111113";
  
  // Left block of rear sight blade
  ctx.fillRect(-bladeWidthPx/2, 0, bladeWidthPx/2 - notchWidthPx/2, bladeHeightPx);
  // Right block of rear sight blade
  ctx.fillRect(notchWidthPx/2, 0, bladeWidthPx/2 - notchWidthPx/2, bladeHeightPx);
  // Bottom block under notch
  ctx.fillRect(-notchWidthPx/2, notchDepthPx, notchWidthPx, bladeHeightPx - notchDepthPx);
  
  // Horizontal anti-glare serrations (fine lines to reduce glare)
  ctx.strokeStyle = "#232328";
  ctx.lineWidth = 1;
  for (let sy = 10; sy < bladeHeightPx; sy += 8) {
    if (sy < notchDepthPx) {
      // Left part serration
      ctx.beginPath();
      ctx.moveTo(-bladeWidthPx/2, sy);
      ctx.lineTo(-notchWidthPx/2, sy);
      ctx.stroke();
      
      // Right part serration
      ctx.beginPath();
      ctx.moveTo(notchWidthPx/2, sy);
      ctx.lineTo(bladeWidthPx/2, sy);
      ctx.stroke();
    } else {
      // Full width serration
      ctx.beginPath();
      ctx.moveTo(-bladeWidthPx/2, sy);
      ctx.lineTo(bladeWidthPx/2, sy);
      ctx.stroke();
    }
  }
  
  // Top edge highlights
  ctx.strokeStyle = "#404046";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-bladeWidthPx/2, 0);
  ctx.lineTo(-notchWidthPx/2, 0);
  ctx.lineTo(-notchWidthPx/2, notchDepthPx);
  ctx.lineTo(notchWidthPx/2, notchDepthPx);
  ctx.lineTo(notchWidthPx/2, 0);
  ctx.lineTo(bladeWidthPx/2, 0);
  ctx.stroke();
  
  // Slide (culasse) beneath the blade
  const slideWidthPx = 110;
  ctx.fillStyle = "#19191c";
  ctx.fillRect(-slideWidthPx/2, bladeHeightPx, slideWidthPx, 500); // 500px long to span to viewport bottom
  
  // Slide side bevels (highlights for 3D look)
  ctx.fillStyle = "#27272b"; // left highlight
  ctx.fillRect(-slideWidthPx/2, bladeHeightPx, 4, 500);
  ctx.fillStyle = "#0c0c0e"; // right shadow
  ctx.fillRect(slideWidthPx/2 - 4, bladeHeightPx, 4, 500);
  
  ctx.restore();
  ctx.restore(); // end cant
  ctx.restore(); // end clip
  
  // Draw visual label/overlay
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(10, 10, 150, 25);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 10px sans-serif";
  ctx.fillText("1. VISÉE (HAUSSE & GUIDON)", 18, 26);
}

function getBlurFilters() {
  if (focusType === "front") {
    return { front: 0, rear: 1.5, target: 8 };
  } else if (focusType === "target") {
    return { front: 6, rear: 9, target: 0 };
  } else {
    return { front: 2.5, rear: 0, target: 9 };
  }
}

function drawRightViewport(state) {
  const activeTarget = TARGETS[targetKey];
  
  // 1. Background
  ctx.fillStyle = "#141d26";
  ctx.fillRect(split, 0, split, H - panelH);
  
  ctx.save();
  ctx.beginPath();
  ctx.rect(split + 2, 2, split - 4, H - panelH - 4);
  ctx.clip();
  
  // Draw card background
  ctx.fillStyle = "#faf6e8";
  ctx.fillRect(split, 0, split, H - panelH);
  
  // 2. Draw Target Rings
  ctx.fillStyle = "#151515";
  ctx.beginPath();
  ctx.arc(tx, ty, activeTarget.black_r * activeTarget.scale_right, 0, Math.PI * 2);
  ctx.fill();
  
  ctx.lineWidth = 1;
  activeTarget.rings.forEach(ring => {
    ctx.beginPath();
    ctx.arc(tx, ty, ring.r * activeTarget.scale_right, 0, Math.PI * 2);
    ctx.strokeStyle = (ring.num >= 7) ? "#ffffff" : "#151515";
    ctx.stroke();
    
    // Numbers
    if (ring.num <= 9) {
      ctx.fillStyle = (ring.num >= 7) ? "#ffffff" : "#151515";
      ctx.font = "10px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const offset = (ring.r - activeTarget.ring_spacing_mm / 2) * activeTarget.scale_right;
      ctx.fillText(ring.num, tx, ty - offset);
      ctx.fillText(ring.num, tx, ty + offset);
      ctx.fillText(ring.num, tx - offset, ty);
      ctx.fillText(ring.num, tx + offset, ty);
    }
  });
  
  ctx.beginPath();
  ctx.arc(tx, ty, activeTarget.mouche_r * activeTarget.scale_right, 0, Math.PI * 2);
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
  
  // 3. Draw Past Shots
  shots.forEach((shot, index) => {
    const shotX = tx + (shot.x * activeTarget.scale_right);
    const shotY = ty - (shot.y * activeTarget.scale_right); // Subtract because +Y target is UP
    const bulletRadiusPx = activeTarget.bullet_r_mm * activeTarget.scale_right;
    
    ctx.beginPath();
    ctx.arc(shotX, shotY, bulletRadiusPx, 0, Math.PI * 2);
    ctx.fillStyle = "#181818";
    ctx.fill();
    ctx.strokeStyle = "#555";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    
    // Impact grease ring
    ctx.beginPath();
    ctx.arc(shotX, shotY, bulletRadiusPx + 1, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(0,0,0,0.3)";
    ctx.stroke();
    
    // Number label
    ctx.fillStyle = "#ff6b6b";
    ctx.font = "bold 9px sans-serif";
    ctx.fillText(index + 1, shotX, shotY - bulletRadiusPx - 5);
  });
  
  // Highlight latest shot
  if (shots.length > 0) {
    const last = shots[shots.length - 1];
    const lastX = tx + (last.x * activeTarget.scale_right);
    const lastY = ty - (last.y * activeTarget.scale_right);
    const bulletRadiusPx = activeTarget.bullet_r_mm * activeTarget.scale_right;
    
    ctx.beginPath();
    ctx.arc(lastX, lastY, bulletRadiusPx + 3, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(46, 204, 113, 0.8)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  
  // 4. Real-time Indicators
  // Point of impact (red dot)
  const curImpX = tx + (state.impactX * activeTarget.scale_right);
  const curImpY = ty - (state.impactY * activeTarget.scale_right);
  
  ctx.beginPath();
  ctx.arc(curImpX, curImpY, 3, 0, Math.PI * 2);
  ctx.fillStyle = "#e74c3c";
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1;
  ctx.stroke();
  
  // Point of aim (dynamic cyan circle)
  const curAimX = tx + (state.aimX * activeTarget.scale_right);
  const curAimY = ty - (state.aimY * activeTarget.scale_right);
  
  ctx.beginPath();
  ctx.arc(curAimX, curAimY, 5, 0, Math.PI * 2);
  ctx.strokeStyle = "#3498db";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  
  // Draw Wind indicator
  drawWindIndicator();
  ctx.restore(); // end clip
  
  // Draw visual label/overlay
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(split + 10, 10, 160, 25);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 10px sans-serif";
  ctx.fillText("2. CIBLE ET IMPACTS", split + 18, 26);
}

function drawWindIndicator() {
  const wx = W - 60;
  const wy = 60;
  
  ctx.beginPath();
  ctx.arc(wx, wy, 25, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.15)";
  ctx.lineWidth = 2;
  ctx.stroke();
  
  if (windSpeed > 0) {
    // Arrow points in the direction the wind blows (opposite of the "comes from" angle),
    // i.e. the same direction the impact is pushed.
    const windRad = (windDirDeg * Math.PI) / 180;
    const endX = wx - Math.sin(windRad) * 20;
    const endY = wy + Math.cos(windRad) * 20;
    
    ctx.beginPath();
    ctx.moveTo(wx, wy);
    ctx.lineTo(endX, endY);
    ctx.strokeStyle = "#2980b9";
    ctx.lineWidth = 3;
    ctx.stroke();
    
    ctx.beginPath();
    ctx.arc(endX, endY, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#2980b9";
    ctx.fill();
  }
  
  ctx.fillStyle = "#2c3e50";
  ctx.font = "bold 10px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`${windSpeed.toFixed(1)} m/s`, wx, wy + 40);
}

function drawBottomPanel(state) {
  ctx.fillStyle = "#141d26";
  ctx.fillRect(0, H - panelH, W, panelH);
  
  ctx.fillStyle = "#2ecc71";
  ctx.font = "12px monospace";
  ctx.textAlign = "left";
  
  const activeTarget = TARGETS[targetKey];
  const curScore = calculateScore(state.impactX, state.impactY).score;
  
  ctx.fillText(`GUIDON: ${alignErrX > 0 ? "+" : ""}${alignErrX.toFixed(2)} mm (X) | ${alignErrY > 0 ? "+" : ""}${alignErrY.toFixed(2)} mm (Y)`, 20, H - 40);
  ctx.fillText(`HAUSSE CLICS: ${clicksX > 0 ? "D" : "G"}${Math.abs(clicksX)} | ${clicksY > 0 ? "H" : "B"}${Math.abs(clicksY)}`, 20, H - 20);
  
  ctx.fillStyle = "#3498db";
  ctx.fillText(`DIST: ${activeTarget.distance_mm / 1000}m | INCLINAISON: ${cantDeg.toFixed(1)}°`, 380, H - 40);
  ctx.fillText(`VISÉE: ${holdType === "6oclock" ? "Sous visuel (6h)" : "Plein Centre"}`, 380, H - 20);
  
  ctx.fillStyle = "#e74c3c";
  ctx.fillText(`SCORE VIRTUEL INSTANTANÉ: ${curScore.toFixed(1)}`, 680, H - 40);
  
  ctx.fillStyle = "#888";
  ctx.font = "11px sans-serif";
  ctx.fillText("Contrôles clavier: Z/X(Inclinaison) | WASD(Micro-alignement) | Espace(Tirer)", 680, H - 20);
}

// --- Interaction Logic & Actions ---

function fireShot() {
  const state = computeState();
  const res = calculateScore(state.impactX, state.impactY);
  
  shots.push({
    x: state.impactX,
    y: state.impactY,
    score: res.score,
    isMouche: res.isMouche
  });
  
  updateDashboard();
}

function resetShots() {
  shots = [];
  updateDashboard();
}

function resetSights() {
  alignErrX = 0.0;
  alignErrY = 0.0;
  cantDeg = 0.0;
  clicksX = 0;
  clicksY = 0;
  syncSliders();
}

function updateDashboard() {
  const shotsListEl = document.getElementById("shotsList");
  const countEl = document.getElementById("statsShotsCount");
  const avgEl = document.getElementById("statsAvgScore");
  const lastEl = document.getElementById("statsLastScore");
  const dispEl = document.getElementById("statsDispersion");
  
  if (!countEl) return;
  
  countEl.innerText = shots.length;
  
  if (shots.length === 0) {
    avgEl.innerText = "--";
    lastEl.innerText = "--";
    dispEl.innerText = "--";
    shotsListEl.innerHTML = "<li class='empty-list'>Aucun tir effectué</li>";
    return;
  }
  
  const sum = shots.reduce((acc, s) => acc + s.score, 0);
  const avg = sum / shots.length;
  avgEl.innerText = avg.toFixed(1);
  
  const lastShot = shots[shots.length - 1];
  lastEl.innerText = lastShot.score.toFixed(1) + (lastShot.isMouche ? " (M)" : "");
  
  if (shots.length >= 2) {
    let maxDist = 0;
    for (let i = 0; i < shots.length; i++) {
      for (let j = i + 1; j < shots.length; j++) {
        const d = Math.hypot(shots[i].x - shots[j].x, shots[i].y - shots[j].y);
        if (d > maxDist) maxDist = d;
      }
    }
    dispEl.innerText = maxDist.toFixed(1) + " mm";
  } else {
    dispEl.innerText = "0.0 mm";
  }
  
  let html = "";
  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i];
    html += `<li>Tir ${i + 1} : <strong style="color:var(--color-accent)">${s.score.toFixed(1)}</strong>${s.isMouche ? " <span class='mouche-badge' title='Mouche'>M</span>" : ""}</li>`;
  }
  shotsListEl.innerHTML = html;
}

function syncSliders() {
  const slX = document.getElementById("alignErrX");
  const slY = document.getElementById("alignErrY");
  const slCant = document.getElementById("cantAngle");
  const dispX = document.getElementById("alignErrXVal");
  const dispY = document.getElementById("alignErrYVal");
  const dispCant = document.getElementById("cantAngleVal");
  
  const inputClicksX = document.getElementById("clicksX");
  const inputClicksY = document.getElementById("clicksY");
  
  if (slX) {
    slX.value = alignErrX;
    dispX.innerText = (alignErrX > 0 ? "+" : "") + alignErrX.toFixed(2);
  }
  if (slY) {
    slY.value = alignErrY;
    dispY.innerText = (alignErrY > 0 ? "+" : "") + alignErrY.toFixed(2);
  }
  if (slCant) {
    slCant.value = cantDeg;
    dispCant.innerText = cantDeg.toFixed(1);
  }
  if (inputClicksX) inputClicksX.value = clicksX;
  if (inputClicksY) inputClicksY.value = clicksY;
}

// --- External UI listeners config ---

function resetAimToHold() {
  const t = TARGETS[targetKey];
  mouseAimX = 0.0;
  mouseAimY = (holdType === "6oclock") ? -(t.black_r + 6.0) : 0.0;
}

window.onTargetChange = function(val) {
  targetKey = val;
  resetAimToHold();
  resetShots();
};

window.onHoldChange = function(val) {
  holdType = val;
  resetAimToHold();
};

window.onFocusChange = function(val) {
  focusType = val;
};

window.onWobblePresetChange = function(val) {
  wobblePreset = val;
  const slider = document.getElementById("wobbleAmp");
  
  let amp = 5.0;
  if (val === "none") amp = 0.0;
  else if (val === "expert") amp = 2.0;
  else if (val === "confirmed") amp = 5.0;
  else if (val === "beginner") amp = 10.0;
  
  wobbleAmp = amp;
  if (slider) slider.value = amp;
};

window.onWobbleAmpChange = function(val) {
  wobbleAmp = parseFloat(val);
  document.getElementById("wobblePreset").value = "custom";
};

window.onAlignErrXChange = function(val) {
  alignErrX = parseFloat(val);
  document.getElementById("alignErrXVal").innerText = (alignErrX > 0 ? "+" : "") + alignErrX.toFixed(2);
};

window.onAlignErrYChange = function(val) {
  alignErrY = parseFloat(val);
  document.getElementById("alignErrYVal").innerText = (alignErrY > 0 ? "+" : "") + alignErrY.toFixed(2);
};

window.onCantAngleChange = function(val) {
  cantDeg = parseFloat(val);
  document.getElementById("cantAngleVal").innerText = cantDeg.toFixed(1);
};

window.onClicksXChange = function(val) {
  clicksX = parseInt(val) || 0;
};

window.onClicksYChange = function(val) {
  clicksY = parseInt(val) || 0;
};

window.onWindSpeedChange = function(val) {
  windSpeed = parseFloat(val);
  document.getElementById("windSpeedVal").innerText = windSpeed.toFixed(1);
};

window.onWindDirChange = function(val) {
  windDirDeg = parseInt(val);
  document.getElementById("windDirVal").innerText = windDirDeg;
};

window.onFrontPostWidthChange = function(val) {
  frontPostWidth = parseFloat(val);
};

window.onRearNotchWidthChange = function(val) {
  rearNotchWidth = parseFloat(val);
};

window.onRearNotchDepthChange = function(val) {
  rearNotchDepth = parseFloat(val);
};

window.fireShot = fireShot;
window.resetShots = resetShots;
window.resetSights = resetSights;

// --- Animation Loop ---

function animate() {
  updateWobble();
  const state = computeState();
  
  // Render viewports
  drawLeftViewport(state);
  drawRightViewport(state);
  drawBottomPanel(state);
  
  // draw divider line
  ctx.beginPath();
  ctx.moveTo(split, 0);
  ctx.lineTo(split, H - panelH);
  ctx.strokeStyle = "#888";
  ctx.lineWidth = 1;
  ctx.stroke();
  
  requestAnimationFrame(animate);
}

// Initial draw config
syncSliders();
updateDashboard();
animate();
