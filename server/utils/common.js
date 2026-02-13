const colorValidator = (v) => /^#([0-9a-f]{3}){1,2}$/i.test(v);

function hexToRgb(hex) {
    const bigint = parseInt(hex.replace('#', ''), 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return [r, g, b];
}

/**
 * The greater the canvas size, the more time it will take to create
 * canvas and its respective pixels on MongoDB.
 *
 * ! Do not change this value unless you know what you are doing.
 * ! canvasSize on frontend must be updated manually.
 */
const canvasSize = 1000;

module.exports = { colorValidator, canvasSize, hexToRgb };
