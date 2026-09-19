// Profiles: transition on profile switch.
//
// oldFrame is a frozen capture of the whole screen (bars, windows, wallpaper)
// from before the switch. The new profile is already live underneath. The
// shader removes the old frame depending on the kind. Output is premultiplied,
// alpha = how much of the old frame is still shown. Optionally the accent color
// of the new profile glows along the edges (additive).
//
// The new frame is not available as a texture (it is live underneath), so only
// kinds that move, distort or remove the OLD frame are possible. No cube, no
// sliding in of the new frame.
//
// twoPhase = 1: the animation does not wait for the new profile. It runs from
// the old frame onto the new WALLPAPER (newFrame, already cropped to the
// screen) and ends opaque on it; the shell rebuilds underneath and is faded in
// afterwards through qt_Opacity.
//
//  0 fade      1 wipe       2 disc       3 iris       4 pixel
//  5 stripes   6 ember      7 zoom       8 slide      9 doors
// 10 blinds   11 squares   12 wave      13 clock     14 dots
// 15 swirl    16 ripple    17 melt      18 blur      19 dissolve
// 20 black    21 shatter   22 glitch    23 crt       24 glitchcode
// 25 glitchvhs 26 glitchsort 27 glitchscan 28 snow

#version 440

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;

    float progress;     // 0 old frame fully shown, 1 gone
    float kind;
    float screenW;      // screen in px
    float screenH;
    float seed;         // 0..1, new for every switch (direction, pattern)
    float glow;         // 0 no edge glow, 1 full
    float preview;      // 1: old frame desaturated (trying out without a switch)
    vec4 edgeColor;
    float twoPhase;     // 1: new wallpaper under the old frame instead of the live screen
} ubuf;

layout(binding = 1) uniform sampler2D oldFrame;
layout(binding = 2) uniform sampler2D newFrame;

const float PI = 3.14159265;

float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float hash1(float n) {
    return fract(sin(n * 91.3458) * 47453.5453);
}

vec2 hash2(vec2 p) {
    return vec2(hash(p), hash(p + vec2(17.13, 3.71)));
}

float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
    float s = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
        s += a * valueNoise(p);
        p *= 2.03;
        a *= 0.5;
    }
    return s;
}

// alpha of the old frame: 1 where `value` is above the threshold
float keep(float value, float threshold, float w) {
    return smoothstep(threshold - w, threshold, value);
}

// narrow glow band along the soft edge
float edgeBand(float value, float threshold, float w) {
    float d = (value - threshold + w * 0.5) / (w * 0.35);
    return exp(-d * d);
}

vec2 direction4(float r) {
    float k = floor(r * 4.0);
    if (k < 0.5) return vec2(1.0, 0.0);
    if (k < 1.5) return vec2(-1.0, 0.0);
    if (k < 2.5) return vec2(0.0, 1.0);
    return vec2(0.0, -1.0);
}

bool insideUnit(vec2 q) {
    return q.x >= 0.0 && q.y >= 0.0 && q.x <= 1.0 && q.y <= 1.0;
}

void main() {
    vec2 uv = qt_TexCoord0;
    float p = clamp(ubuf.progress, 0.0, 1.0);
    float aspect = ubuf.screenW / max(1.0, ubuf.screenH);
    vec2 px = vec2(ubuf.screenW, ubuf.screenH);
    int kind = int(ubuf.kind + 0.5);
    float z = ubuf.seed;

    vec2 uvSrc = uv;
    float a = 1.0;
    float edge = 0.0;
    vec3 col = vec3(0.0);
    bool done = false;      // color already computed by the kind itself
    float bright = 1.0;     // brightness of the old frame

    if (kind == 1) {
        // wipe: one of four directions, slightly slanted
        float angle = floor(z * 4.0) * 1.5707963 + 0.18;
        vec2 dir = vec2(cos(angle), sin(angle));
        vec2 q = (uv - 0.5) * vec2(aspect, 1.0);
        float extent = 0.5 * (abs(dir.x) * aspect + abs(dir.y));
        float s = dot(q, dir) / extent * 0.5 + 0.5;
        float w = 0.08;
        float f = p * (1.0 + w);
        a = keep(s, f, w);
        edge = edgeBand(s, f, w * 0.9);
    } else if (kind == 2 || kind == 3) {
        vec2 q = (uv - 0.5) * vec2(aspect, 1.0);
        float maxd = length(vec2(aspect, 1.0)) * 0.5;
        float d = length(q) / maxd;
        float w = 0.07;
        if (kind == 2) {
            float r = p * (1.0 + w);
            a = keep(d, r, w);
            edge = edgeBand(d, r, w) * smoothstep(0.02, 0.2, r);
        } else {
            float r = (1.0 - p) * (1.0 + w);
            a = 1.0 - keep(d, r, w);
            edge = edgeBand(d, r, w) * smoothstep(0.02, 0.2, r);
        }
    } else if (kind == 4) {
        float size = mix(1.0, 72.0, p * p);
        uvSrc = (floor(uv * px / size) + 0.5) * size / px;
        a = 1.0 - smoothstep(0.55, 1.0, p);
    } else if (kind == 5) {
        float n = 14.0;
        float x = uv.x + (uv.y - 0.5) * 0.12;
        float i = floor(x * n);
        float delay = hash(vec2(i, floor(z * 97.0))) * 0.45;
        float lp = clamp((p - delay) / 0.55, 0.0, 1.0);
        float y = mod(i, 2.0) < 0.5 ? uv.y : 1.0 - uv.y;
        float w = 0.05;
        float f = lp * (1.0 + w);
        a = keep(y, f, w);
        edge = edgeBand(y, f, w) * step(0.001, lp) * step(lp, 0.999);
    } else if (kind == 6) {
        float n = fbm(uv * vec2(aspect, 1.0) * 3.2 + z * 31.0);
        n = n * 0.85 + 0.15 * (1.0 - length(uv - 0.5));
        float w = 0.045;
        float f = p * (1.0 + 2.0 * w) - w;
        a = keep(n, f, w * 0.5);
        edge = edgeBand(n, f, w * 1.6);
    } else if (kind == 7) {
        float zoom = 1.0 + 0.22 * p;
        uvSrc = (uv - 0.5) / zoom + 0.5;
        a = 1.0 - smoothstep(0.0, 1.0, p);
    } else if (kind == 8) {
        // slide: the old frame glides out as a whole
        vec2 dir = direction4(z);
        uvSrc = uv - dir * p;
        a = insideUnit(uvSrc) ? 1.0 : 0.0;
        // glowing edge on the trailing side
        float trail = dir.x != 0.0 ? (dir.x > 0.0 ? uv.x - p : (1.0 - uv.x) - p) : (dir.y > 0.0 ? uv.y - p : (1.0 - uv.y) - p);
        edge = exp(-pow(trail / 0.006, 2.0));
        bright = 1.0 - 0.25 * p;
    } else if (kind == 9) {
        // doors: split in the middle, both halves slide apart
        bool vertical = z > 0.5;
        float t = p * p * (3.0 - 2.0 * p) * 0.5;
        float c = vertical ? uv.y : uv.x;
        float lq = c + t;   // left or top door
        float rq = c - t;   // right or bottom door
        float s = c;
        if (lq < 0.5) {
            s = lq;
            edge = exp(-pow((0.5 - lq) / 0.004, 2.0));
        } else if (rq >= 0.5) {
            s = rq;
            edge = exp(-pow((rq - 0.5) / 0.004, 2.0));
        } else {
            a = 0.0;
        }
        uvSrc = vertical ? vec2(uv.x, s) : vec2(s, uv.y);
        bright = 1.0 - 0.3 * p;
    } else if (kind == 10) {
        // blinds: horizontal slats close towards their own center
        float n = 16.0;
        float i = floor(uv.y * n);
        float f = fract(uv.y * n);
        float lp = clamp((p - i / n * 0.3) / 0.7, 0.0, 1.0);
        float halfOpen = 0.5 * (1.0 - lp);
        float d = abs(f - 0.5);
        float w = 0.04;
        a = 1.0 - smoothstep(halfOpen - w, halfOpen, d);
        edge = edgeBand(-d, -halfOpen, w) * step(0.01, lp) * step(lp, 0.99);
    } else if (kind == 11) {
        // squares shrink in random order
        vec2 grid = vec2(floor(16.0 * aspect / 1.6), 10.0);
        vec2 cell = floor(uv * grid);
        vec2 local = fract(uv * grid) - 0.5;
        float delay = hash(cell + floor(z * 53.0)) * 0.6;
        float lp = clamp((p - delay) / 0.4, 0.0, 1.0);
        float halfSize = 0.5 * (1.0 - lp);
        float d = max(abs(local.x), abs(local.y));
        a = 1.0 - smoothstep(halfSize - 0.02, halfSize, d);
        a *= 1.0 - lp * 0.3;
        edge = edgeBand(-d, -halfSize, 0.05) * step(0.01, lp) * step(lp, 0.99) * 0.7;
    } else if (kind == 12) {
        // wave: wipe with an oscillating edge
        vec2 dir = direction4(z);
        float s = dir.x != 0.0 ? (dir.x > 0.0 ? uv.x : 1.0 - uv.x) : (dir.y > 0.0 ? uv.y : 1.0 - uv.y);
        float across = dir.x != 0.0 ? uv.y : uv.x;
        float amp = 0.06;
        float w = 0.03;
        float f = p * (1.0 + 2.0 * amp + w) - amp + amp * sin(across * 14.0 + p * 9.0) * (1.0 - p * 0.5);
        a = keep(s, f, w);
        edge = edgeBand(s, f, w);
    } else if (kind == 13) {
        // clock: sweep starting at twelve o'clock
        vec2 q = (uv - 0.5) * vec2(aspect, 1.0);
        float angle = fract(atan(q.x, -q.y) / (2.0 * PI) + 1.0);
        float w = 0.02;
        float f = p * (1.0 + w);
        a = keep(angle, f, w);
        edge = edgeBand(angle, f, w) * smoothstep(0.0, 0.3, length(q));
    } else if (kind == 14) {
        // dots: circles grow from the center outwards
        float n = 22.0;
        vec2 grid = vec2(n * aspect, n);
        vec2 cell = floor(uv * grid);
        vec2 local = fract(uv * grid) - 0.5;
        vec2 center = (cell + 0.5) / grid - 0.5;
        float dc = length(center * vec2(aspect, 1.0)) / (0.5 * length(vec2(aspect, 1.0)));
        float lp = clamp((p - dc * 0.55) / 0.45, 0.0, 1.0);
        float r = lp * 0.75;
        float d = length(local);
        a = keep(d, r, 0.06);
        edge = edgeBand(d, r, 0.08) * step(0.01, lp) * step(lp, 0.95) * 0.6;
    } else if (kind == 15) {
        // swirl
        vec2 q = (uv - 0.5) * vec2(aspect, 1.0);
        float d = length(q);
        float radius = 0.5 * length(vec2(aspect, 1.0));
        float strength = p * p * 9.0 * pow(max(0.0, 1.0 - d / radius), 2.0);
        float s = sin(strength);
        float c = cos(strength);
        q = mat2(c, -s, s, c) * q;
        uvSrc = q / vec2(aspect, 1.0) + 0.5;
        a = (1.0 - smoothstep(0.35, 1.0, p)) * (insideUnit(uvSrc) ? 1.0 : 0.0);
    } else if (kind == 16) {
        // ripple rings like on water
        vec2 q = (uv - 0.5) * vec2(aspect, 1.0);
        float d = length(q);
        vec2 dir = d > 0.0001 ? q / d : vec2(0.0);
        float ripple = sin(d * 55.0 - p * 38.0) * 0.022 * p * (1.0 - p * 0.4);
        uvSrc = uv + dir * ripple / vec2(aspect, 1.0);
        a = 1.0 - smoothstep(0.3, 1.0, p);
        bright = 1.0 + ripple * 6.0;
    } else if (kind == 17) {
        // melt: columns slide down, each at its own speed
        float columns = 120.0;
        float i = floor(uv.x * columns);
        float delay = (hash1(i + floor(z * 77.0)) * 0.6 + hash1(floor(i / 6.0) + 3.0) * 0.4) * 0.35;
        float t = max(0.0, p - delay) / (1.0 - delay * 0.6);
        float drop = t * t * 1.6;
        uvSrc = vec2(uv.x, uv.y - drop);
        a = uvSrc.y >= 0.0 ? 1.0 : 0.0;
        edge = exp(-pow(uvSrc.y / 0.004, 2.0)) * step(0.001, drop) * 0.8;
    } else if (kind == 18) {
        // blur: disc blur grows while fading out
        float r = p * 0.035;
        vec3 sum = vec3(0.0);
        for (int k = 0; k < 16; k++) {
            float fk = float(k);
            float w = fk * 2.39996;
            float rr = r * sqrt((fk + 0.5) / 16.0);
            vec2 o = vec2(cos(w), sin(w)) * rr / vec2(aspect, 1.0);
            sum += texture(oldFrame, clamp(uv * (1.0 - p * 0.04) + p * 0.02 + o, 0.0, 1.0)).rgb;
        }
        col = sum / 16.0;
        done = true;
        a = 1.0 - smoothstep(0.25, 1.0, p);
    } else if (kind == 19) {
        // dissolve: coarse grain disappears in random order
        float grain = hash(floor(uv * px / 3.0) + floor(z * 13.0));
        a = smoothstep(p - 0.04, p, grain * 0.96 + 0.02);
    } else if (kind == 20) {
        // through black: darken first, then the new frame comes out of black
        bright = 1.0 - smoothstep(0.0, 0.5, p);
        a = 1.0 - smoothstep(0.5, 1.0, p);
    } else if (kind == 21) {
        // shatter: Voronoi shards break apart, shrink, rotate and fall
        vec2 grid = vec2(9.0 * aspect, 9.0);
        vec2 cellPos = uv * grid;
        vec2 base = floor(cellPos);
        a = 0.0;
        float t = smoothstep(0.08, 1.0, p);
        // Shards fall up to 2.6 cells down and drift at most 0.8 sideways, so
        // the search is 3 wide and 4 deep upwards. Longer paths need a larger
        // search; with unbounded drift the search found no shard after half
        // the animation and the frame simply vanished.
        for (int j = -3; j <= 1; j++) {
            for (int i = -1; i <= 1; i++) {
                vec2 cell = base + vec2(float(i), float(j));
                vec2 c = cell + 0.15 + 0.7 * hash2(cell + floor(z * 41.0));
                float spin = (hash(cell + 5.0) - 0.5) * 3.0 * t;
                float size = max(0.001, 1.0 - t * (0.7 + 0.3 * hash(cell + 9.0)));
                vec2 drift = vec2((c.x / grid.x - 0.5) * 1.6 * t, 2.6 * t * t);
                vec2 rel = cellPos - c - drift;
                float s = sin(-spin);
                float co = cos(-spin);
                rel = mat2(co, -s, s, co) * rel / size;
                vec2 src = c + rel;
                // does src belong to this shard? check the nearest seed point
                vec2 sb = floor(src);
                float best = 1e9;
                float second = 1e9;
                vec2 bestCell = vec2(-999.0);
                for (int jj = -1; jj <= 1; jj++) {
                    for (int ii = -1; ii <= 1; ii++) {
                        vec2 z2 = sb + vec2(float(ii), float(jj));
                        vec2 c2 = z2 + 0.15 + 0.7 * hash2(z2 + floor(z * 41.0));
                        float d2 = length(src - c2);
                        if (d2 < best) {
                            second = best;
                            best = d2;
                            bestCell = z2;
                        } else if (d2 < second) {
                            second = d2;
                        }
                    }
                }
                if (bestCell == cell) {
                    uvSrc = src / grid;
                    a = insideUnit(uvSrc) ? 1.0 - smoothstep(0.55, 1.0, p) : 0.0;
                    edge = exp(-pow((second - best) / 0.05, 2.0)) * (1.0 - smoothstep(0.0, 0.5, p)) * smoothstep(0.0, 0.05, p) * 1.5;
                }
            }
        }
    } else if (kind == 22) {
        // glitch: frame tears, color channels split, blocks jump, noise and
        // interlacing, then it breaks up block by block
        float tick = floor(p * 42.0) + floor(z * 1000.0);
        float I = smoothstep(0.0, 0.18, p);
        vec2 q = uv;

        // vertical jumps of single frames
        if (hash1(tick * 1.7) > 0.72)
            q.y = fract(q.y + (hash1(tick + 4.0) - 0.5) * 0.08 * I);

        // horizontal tears: bands with their own offset
        float bands = mix(10.0, 48.0, hash1(tick + 2.0));
        float band = floor(q.y * bands);
        float bh = hash(vec2(band, tick));
        if (bh > 1.0 - 0.45 * I)
            q.x += (hash(vec2(band + 9.0, tick)) - 0.5) * 0.35 * I;

        // data blocks in the wrong place
        vec2 blockGrid = vec2(24.0, 14.0);
        vec2 blk = floor(q * blockGrid);
        float bz = hash(blk + vec2(tick * 0.37, tick));
        if (bz > 1.0 - 0.22 * I)
            q += (hash2(blk + tick) - 0.5) * 0.25 * I;

        // color channels offset
        float shift = (0.004 + 0.03 * hash1(tick + 7.0)) * I;
        vec2 vr = vec2(shift, shift * 0.3 * (hash1(tick + 8.0) - 0.5));
        float r = texture(oldFrame, fract(q + vr)).r;
        float g = texture(oldFrame, fract(q)).g;
        float b = texture(oldFrame, fract(q - vr)).b;
        col = vec3(r, g, b);

        // single blocks inverted or tinted with the accent color
        float bf = hash(blk * 1.3 + tick * 2.1);
        if (bf > 1.0 - 0.06 * I)
            col = 1.0 - col;
        else if (bf > 1.0 - 0.14 * I)
            col = mix(col, ubuf.edgeColor.rgb * dot(col, vec3(0.333)) * 2.2, 0.8 * max(ubuf.glow, 0.4));

        // color quantization, scanlines, noise
        float levels = mix(64.0, 5.0, I * hash1(tick + 11.0));
        col = floor(col * levels) / levels;
        col *= 0.82 + 0.18 * sin(uv.y * ubuf.screenH * 1.4 + tick);
        col += (hash(uv * px + tick) - 0.5) * 0.35 * I;
        col = clamp(col, 0.0, 1.0);
        done = true;

        // break-up: blocks vanish, single frames briefly jump to the new profile
        vec2 breakGrid = vec2(32.0, 18.0);
        float zb = hash(floor(uv * breakGrid) + floor(z * 91.0));
        a = step(smoothstep(0.35, 1.0, p) * 1.05, zb);
        if (p > 0.25 && hash1(tick * 3.3) > 1.0 - 0.3 * p)
            a = 0.0;
        if (p > 0.97)
            a = 0.0;
    } else if (kind == 23) {
        // crt off: vertically to a line, horizontally to a dot, bright flash
        float sy = mix(1.0, 0.003, smoothstep(0.0, 0.5, p));
        float sx = mix(1.0, 0.002, smoothstep(0.5, 0.82, p));
        vec2 q = uv - 0.5;
        uvSrc = vec2(q.x / sx, q.y / sy) + 0.5;
        float inY = 1.0 - smoothstep(0.5 * sy, 0.5 * sy + 1.5 / ubuf.screenH, abs(q.y));
        float inX = 1.0 - smoothstep(0.5 * sx, 0.5 * sx + 1.5 / ubuf.screenW, abs(q.x));
        a = inY * inX * (1.0 - smoothstep(0.82, 1.0, p));
        bright = 1.0 + 3.5 * smoothstep(0.1, 0.5, p);
        float dot0 = exp(-length(q * vec2(aspect, 1.0)) / 0.01) * smoothstep(0.6, 0.85, p) * (1.0 - smoothstep(0.85, 1.0, p));
        edge = dot0 * 3.0;
    } else if (kind == 24) {
        // glitch code rain: columns of glyphs run over the frame, behind them
        // only code remains, which then breaks up
        vec2 cellSize = vec2(12.0, 18.0);
        vec2 zz = floor(uv * px / cellSize);
        vec2 local = fract(uv * px / cellSize);
        float rows = ubuf.screenH / cellSize.y;
        float speed = 0.9 + hash1(zz.x + floor(z * 71.0)) * 0.9;
        float start = hash1(zz.x * 1.31 + 3.0) * 0.3;
        float head = (p - start) * speed * 1.6;
        float cy = zz.y / rows;
        vec3 prev = texture(oldFrame, uv).rgb;
        vec3 tone = mix(vec3(0.25, 1.0, 0.45), ubuf.edgeColor.rgb, 0.35 * ubuf.glow);
        if (cy < head) {
            vec2 sub = floor(local * vec2(6.0, 8.0));
            float glyph = floor(p * 24.0 + hash(zz) * 9.0);
            float lit = step(0.52, hash(sub + zz * 13.1 + glyph));
            lit *= step(0.5, sub.x) * step(sub.x, 4.5) * step(0.5, sub.y) * step(sub.y, 6.5);
            float behind = head - cy;
            float shine = 0.3 + 0.7 * exp(-behind * 9.0);
            col = prev * 0.15 + tone * lit * shine;
            if (behind < 1.0 / rows)
                col += vec3(0.8) * lit;
            a = 1.0 - smoothstep(0.5, 0.95, p + (hash(zz + 7.0) - 0.5) * 0.25);
        } else {
            col = prev;
        }
        done = true;
    } else if (kind == 25) {
        // glitch vhs: frame rolls and wobbles, colors bleed, a noise band
        // moves through, then the picture fades (the snow is kind 28)
        float I = smoothstep(0.0, 0.3, p);
        float tick = floor(p * 60.0);
        vec2 q = uv;
        q.y = fract(q.y + step(0.35, p) * pow(p - 0.35, 2.0) * 2.2);
        q.x += sin(q.y * 38.0 + p * 70.0) * 0.004 * I;
        q.x += (hash1(floor(q.y * ubuf.screenH / 3.0) + tick) - 0.5) * 0.012 * I;
        float bandCenter = fract(p * 1.7 + z);
        float band = exp(-pow((uv.y - bandCenter) / 0.035, 2.0));
        q.x += band * (hash1(tick + floor(uv.y * 200.0)) - 0.5) * 0.08 * I;
        float bleed = 0.007 * I;
        float r = (texture(oldFrame, fract(q + vec2(bleed, 0.0))).r + texture(oldFrame, fract(q + vec2(bleed * 2.0, 0.0))).r) * 0.5;
        float g = texture(oldFrame, fract(q)).g;
        float b = (texture(oldFrame, fract(q - vec2(bleed, 0.0))).b + texture(oldFrame, fract(q - vec2(bleed * 2.0, 0.0))).b) * 0.5;
        col = vec3(r, g, b);
        float luma = dot(col, vec3(0.299, 0.587, 0.114));
        col = mix(col, vec3(luma) * vec3(0.9, 1.0, 1.05), 0.35 * I);
        col *= 0.85 + 0.15 * sin(uv.y * ubuf.screenH * 1.2);
        col += band * (hash(uv * px + tick) - 0.3) * 0.6 * I;
        done = true;
        a = 1.0 - smoothstep(0.55, 1.0, p);
    } else if (kind == 26) {
        // glitch pixel sort: bright pixels pull long streaks downwards,
        // columns break up one by one
        float column = floor(uv.x * ubuf.screenW / 3.0);
        float len = p * p * (0.05 + 0.25 * hash1(floor(column / 7.0) + floor(z * 17.0)));
        vec3 brightest = texture(oldFrame, uv).rgb;
        float bestLuma = dot(brightest, vec3(0.299, 0.587, 0.114));
        for (int k = 1; k < 10; k++) {
            vec2 qq = vec2(uv.x, uv.y - len * float(k) / 9.0);
            if (qq.y < 0.0)
                break;
            vec3 c = texture(oldFrame, qq).rgb;
            float l = dot(c, vec3(0.299, 0.587, 0.114));
            if (l > bestLuma) {
                bestLuma = l;
                brightest = c;
            }
        }
        col = brightest;
        float tick = floor(p * 36.0);
        float scanRow = floor(uv.y * 30.0);
        if (hash(vec2(scanRow, tick)) > 1.0 - 0.3 * p) {
            float v = (hash(vec2(scanRow + 3.0, tick)) - 0.5) * 0.05;
            col = vec3(texture(oldFrame, vec2(fract(uv.x + v + 0.004), uv.y)).r, col.g, texture(oldFrame, vec2(fract(uv.x + v - 0.004), uv.y)).b);
        }
        done = true;
        a = 1.0 - smoothstep(0.5, 1.0, p + (hash1(floor(column / 4.0) + 5.0) - 0.5) * 0.3);
    } else if (kind == 27) {
        // glitch scan: a beam moves down, behind it only a glowing wireframe of
        // edges remains, which then fades
        // the beam runs well past the bottom edge, so the wireframe behind it
        // has faded out completely when the animation ends
        float beam = p * 1.6 - 0.1;
        vec3 prev = texture(oldFrame, uv).rgb;
        float behind = beam - uv.y;
        if (behind > 0.0) {
            vec2 o = 1.5 / px;
            float l = dot(texture(oldFrame, uv + vec2(o.x, 0.0)).rgb, vec3(0.333)) - dot(texture(oldFrame, uv - vec2(o.x, 0.0)).rgb, vec3(0.333));
            float m = dot(texture(oldFrame, uv + vec2(0.0, o.y)).rgb, vec3(0.333)) - dot(texture(oldFrame, uv - vec2(0.0, o.y)).rgb, vec3(0.333));
            float outline = clamp(length(vec2(l, m)) * 6.0, 0.0, 1.0);
            float gridLines = max(step(0.94, fract(uv.x * 64.0)), step(0.94, fract(uv.y * 40.0))) * 0.12;
            vec3 tone = ubuf.glow > 0.5 ? ubuf.edgeColor.rgb : vec3(0.3, 1.0, 0.8);
            col = prev * 0.08 + tone * (outline + gridLines);
            // the wireframe stays for a while before it fades
            a = 1.0 - smoothstep(0.12, 0.5, behind);
        } else {
            vec2 q = uv;
            float near = exp(-(uv.y - beam) / 0.02);
            q.x += (hash1(floor(uv.y * ubuf.screenH / 4.0) + floor(p * 50.0)) - 0.5) * 0.03 * near;
            col = texture(oldFrame, q).rgb;
        }
        done = true;
        edge = exp(-pow((uv.y - beam) / 0.003, 2.0)) * 1.4;
    } else if (kind == 28) {
        // snowstorm: the picture drowns in static, the sync tears the lines
        // apart, then the static breaks up grain by grain
        float tick = floor(p * 60.0);
        float amount = smoothstep(0.0, 0.45, p);
        vec2 q = uv;
        q.x += (hash1(floor(uv.y * ubuf.screenH / 3.0) + tick * 1.3) - 0.5) * 0.03 * amount;
        vec3 prev = texture(oldFrame, fract(q)).rgb;
        float grain = hash(floor(uv * px / 2.0) + tick * 3.1);
        col = mix(prev, vec3(grain), amount) * (0.9 + 0.2 * hash1(tick + 5.0));
        col *= 0.9 + 0.1 * sin(uv.y * ubuf.screenH * 1.3);
        done = true;
        float gone = smoothstep(0.55, 1.0, p) * 1.1;
        a = smoothstep(gone - 0.1, gone, hash(floor(uv * px / 2.0) + tick * 7.7 + 11.0));
    } else {
        a = 1.0 - p;
    }

    if (!done)
        col = texture(oldFrame, clamp(uvSrc, 0.0, 1.0)).rgb;
    if (kind == 23)
        col = mix(col, vec3(1.0), clamp((bright - 1.0) / 4.0, 0.0, 0.85));
    else
        col *= bright;
    if (ubuf.preview > 0.5)
        col = vec3(dot(col, vec3(0.299, 0.587, 0.114))) * 0.8;

    // edge glow only while moving; the crt kind always glows white
    float envelope = smoothstep(0.0, 0.08, p) * (1.0 - smoothstep(0.9, 1.0, p));
    bool crt = kind == 23;
    edge *= crt ? 1.0 : envelope * ubuf.glow;
    vec3 edgeTone = crt ? vec3(1.0) : ubuf.edgeColor.rgb;
    vec3 light = edgeTone * edge * 0.85 + vec3(1.0, 0.95, 0.85) * pow(min(edge, 1.5), 4.0) * 0.25;

    if (ubuf.twoPhase > 0.5) {
        vec3 wall = texture(newFrame, uv).rgb;
        fragColor = vec4(col * a + light + wall * (1.0 - a), 1.0) * ubuf.qt_Opacity;
        return;
    }
    fragColor = vec4(col * a + light, a) * ubuf.qt_Opacity;
}
