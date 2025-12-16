// FaultyTerminal - Vanilla JS implementation using OGL
// Based on the React component, converted to work without React

function hexToRgb(hex) {
  let h = hex.replace('#', '').trim();
  if (h.length === 3)
    h = h
      .split('')
      .map(c => c + c)
      .join('');
  const num = parseInt(h, 16);
  return [((num >> 16) & 255) / 255, ((num >> 8) & 255) / 255, (num & 255) / 255];
}

const vertexShader = `
attribute vec2 position;
attribute vec2 uv;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const fragmentShader = `
precision mediump float;

varying vec2 vUv;

uniform float iTime;
uniform vec3  iResolution;
uniform float uScale;

uniform vec2  uGridMul;
uniform float uDigitSize;
uniform float uScanlineIntensity;
uniform float uGlitchAmount;
uniform float uFlickerAmount;
uniform float uNoiseAmp;
uniform float uChromaticAberration;
uniform float uDither;
uniform float uCurvature;
uniform vec3  uTint;
uniform vec2  uMouse;
uniform float uMouseStrength;
uniform float uUseMouse;
uniform float uPageLoadProgress;
uniform float uUsePageLoadAnimation;
uniform float uBrightness;
uniform float uWordSeed;

float time;

float hash21(vec2 p){
  p = fract(p * 234.56);
  p += dot(p, p + 34.56);
  return fract(p.x * p.y);
}

float noise(vec2 p)
{
  return sin(p.x * 10.0) * sin(p.y * (3.0 + sin(time * 0.090909))) + 0.2; 
}

mat2 rotate(float angle)
{
  float c = cos(angle);
  float s = sin(angle);
  return mat2(c, -s, s, c);
}

float fbm(vec2 p)
{
  p *= 1.1;
  float f = 0.0;
  float amp = 0.5 * uNoiseAmp;
  
  mat2 modify0 = rotate(time * 0.02);
  f += amp * noise(p);
  p = modify0 * p * 2.0;
  amp *= 0.454545;
  
  mat2 modify1 = rotate(time * 0.02);
  f += amp * noise(p);
  p = modify1 * p * 2.0;
  amp *= 0.454545;
  
  mat2 modify2 = rotate(time * 0.08);
  f += amp * noise(p);
  
  return f;
}

float pattern(vec2 p, out vec2 q, out vec2 r) {
  vec2 offset1 = vec2(1.0);
  vec2 offset0 = vec2(0.0);
  mat2 rot01 = rotate(0.1 * time);
  mat2 rot1 = rotate(0.1);
  
  q = vec2(fbm(p + offset1), fbm(rot01 * p + offset1));
  r = vec2(fbm(rot1 * q + offset0), fbm(q + offset0));
  return fbm(p + r);
}

float digit(vec2 p){
    vec2 grid = uGridMul * 15.0;
    vec2 s = floor(p * grid) / grid;
    p = p * grid;
    vec2 q, r;
    float intensity = pattern(s * 0.1, q, r) * 1.3 - 0.03;
    
    // Add word-based pattern modulation
    if(uWordSeed > 0.0) {
        float wordMod = sin(dot(s, vec2(uWordSeed * 12.9898, uWordSeed * 78.233)) + iTime * 0.1) * 0.3;
        intensity += wordMod;
        
        // Create letter-like regions based on word seed
        vec2 letterPos = mod(s * 3.0 + vec2(uWordSeed * 0.5, uWordSeed * 0.3), vec2(1.0));
        float letterShape = step(0.2, abs(letterPos.x - 0.5)) * step(0.2, abs(letterPos.y - 0.5));
        intensity += letterShape * 0.2 * sin(uWordSeed + iTime * 0.2);
    }
    
    if(uUseMouse > 0.5){
        vec2 mouseWorld = uMouse * uScale;
        float distToMouse = distance(s, mouseWorld);
        float mouseInfluence = exp(-distToMouse * 8.0) * uMouseStrength * 10.0;
        intensity += mouseInfluence;
        
        float ripple = sin(distToMouse * 20.0 - iTime * 5.0) * 0.1 * mouseInfluence;
        intensity += ripple;
    }
    
    if(uUsePageLoadAnimation > 0.5){
        float cellRandom = fract(sin(dot(s, vec2(12.9898, 78.233))) * 43758.5453);
        float cellDelay = cellRandom * 0.8;
        float cellProgress = clamp((uPageLoadProgress - cellDelay) / 0.2, 0.0, 1.0);
        
        float fadeAlpha = smoothstep(0.0, 1.0, cellProgress);
        intensity *= fadeAlpha;
    }
    
    p = fract(p);
    p *= uDigitSize;
    
    float px5 = p.x * 5.0;
    float py5 = (1.0 - p.y) * 5.0;
    float x = fract(px5);
    float y = fract(py5);
    
    float i = floor(py5) - 2.0;
    float j = floor(px5) - 2.0;
    float n = i * i + j * j;
    float f = n * 0.0625;
    
    float isOn = step(0.1, intensity - f);
    float brightness = isOn * (0.2 + y * 0.8) * (0.75 + x * 0.25);
    
    return step(0.0, p.x) * step(p.x, 1.0) * step(0.0, p.y) * step(p.y, 1.0) * brightness;
}

float onOff(float a, float b, float c)
{
	return step(c, sin(iTime + a * cos(iTime * b))) * uFlickerAmount;
}

float displace(vec2 look)
{
    float y = look.y - mod(iTime * 0.25, 1.0);
    float window = 1.0 / (1.0 + 50.0 * y * y);
	  return sin(look.y * 20.0 + iTime) * 0.0125 * onOff(4.0, 2.0, 0.8) * (1.0 + cos(iTime * 60.0)) * window;
}

vec3 getColor(vec2 p){
    
    float bar = step(mod(p.y + time * 20.0, 1.0), 0.2) * 0.4 + 1.0;
    bar *= uScanlineIntensity;
    
    float displacement = displace(p);
    p.x += displacement;

    if (uGlitchAmount != 1.0) {
      float extra = displacement * (uGlitchAmount - 1.0);
      p.x += extra;
    }

    float middle = digit(p);
    
    const float off = 0.002;
    float sum = digit(p + vec2(-off, -off)) + digit(p + vec2(0.0, -off)) + digit(p + vec2(off, -off)) +
                digit(p + vec2(-off, 0.0)) + digit(p + vec2(0.0, 0.0)) + digit(p + vec2(off, 0.0)) +
                digit(p + vec2(-off, off)) + digit(p + vec2(0.0, off)) + digit(p + vec2(off, off));
    
    vec3 baseColor = vec3(0.9) * middle + sum * 0.1 * vec3(1.0) * bar;
    return baseColor;
}

vec2 barrel(vec2 uv){
  vec2 c = uv * 2.0 - 1.0;
  float r2 = dot(c, c);
  c *= 1.0 + uCurvature * r2;
  return c * 0.5 + 0.5;
}

void main() {
    time = iTime * 0.333333;
    vec2 uv = vUv;

    if(uCurvature != 0.0){
      uv = barrel(uv);
    }
    
    vec2 p = uv * uScale;
    vec3 col = getColor(p);

    if(uChromaticAberration != 0.0){
      vec2 ca = vec2(uChromaticAberration) / iResolution.xy;
      col.r = getColor(p + ca).r;
      col.b = getColor(p - ca).b;
    }

    col *= uTint;
    col *= uBrightness;

    if(uDither > 0.0){
      float rnd = hash21(gl_FragCoord.xy);
      col += (rnd - 0.5) * (uDither * 0.003922);
    }

    gl_FragColor = vec4(col, 1.0);
}
`;

export async function createFaultyTerminal(container, options = {}) {
  const {
    scale = 1,
    gridMul = [2, 1],
    digitSize = 1.5,
    timeScale = 0.3,
    pause = false,
    scanlineIntensity = 0.3,
    glitchAmount = 1,
    flickerAmount = 1,
    noiseAmp = 1,
    chromaticAberration = 0,
    dither = 0,
    curvature = 0.2,
    tint = '#ffffff',
    mouseReact = true,
    mouseStrength = 0.2,
    dpr = Math.min(window.devicePixelRatio || 1, 2),
    pageLoadAnimation = true,
    brightness = 1,
    word = '',
  } = options;
  
  // Convert word to seed number
  let wordSeed = 0;
  if (word) {
    for (let i = 0; i < word.length; i++) {
      wordSeed = ((wordSeed << 5) - wordSeed) + word.charCodeAt(i);
      wordSeed = wordSeed & wordSeed; // Convert to 32bit integer
    }
    wordSeed = Math.abs(wordSeed) / 1000000.0; // Normalize
  }

  // Import OGL from CDN using esm.sh for better ES module support
  const { Renderer, Program, Mesh, Color, Triangle } = await import('https://esm.sh/ogl@0.0.88');

  const mouseRef = { x: 0.5, y: 0.5 };
  const smoothMouseRef = { x: 0.5, y: 0.5 };
  let frozenTime = 0;
  let rafId = 0;
  let loadAnimationStart = 0;
  const timeOffset = Math.random() * 100;

  const tintVec = hexToRgb(tint);
  const ditherValue = typeof dither === 'boolean' ? (dither ? 1 : 0) : dither;

  const renderer = new Renderer({ dpr });
  const gl = renderer.gl;
  gl.clearColor(0, 0, 0, 1);

  const geometry = new Triangle(gl);

  const program = new Program(gl, {
    vertex: vertexShader,
    fragment: fragmentShader,
    uniforms: {
      iTime: { value: 0 },
      iResolution: {
        value: new Color(gl.canvas.width, gl.canvas.height, gl.canvas.width / gl.canvas.height)
      },
      uScale: { value: scale },
      uGridMul: { value: new Float32Array(gridMul) },
      uDigitSize: { value: digitSize },
      uScanlineIntensity: { value: scanlineIntensity },
      uGlitchAmount: { value: glitchAmount },
      uFlickerAmount: { value: flickerAmount },
      uNoiseAmp: { value: noiseAmp },
      uChromaticAberration: { value: chromaticAberration },
      uDither: { value: ditherValue },
      uCurvature: { value: curvature },
      uTint: { value: new Color(tintVec[0], tintVec[1], tintVec[2]) },
      uMouse: {
        value: new Float32Array([smoothMouseRef.x, smoothMouseRef.y])
      },
      uMouseStrength: { value: mouseStrength },
      uUseMouse: { value: mouseReact ? 1 : 0 },
      uPageLoadProgress: { value: pageLoadAnimation ? 0 : 1 },
      uUsePageLoadAnimation: { value: pageLoadAnimation ? 1 : 0 },
      uBrightness: { value: brightness },
      uWordSeed: { value: wordSeed }
    }
  });

  const mesh = new Mesh(gl, { geometry, program });

  function resize() {
    if (!container || !renderer) return;
    renderer.setSize(container.offsetWidth, container.offsetHeight);
    program.uniforms.iResolution.value = new Color(
      gl.canvas.width,
      gl.canvas.height,
      gl.canvas.width / gl.canvas.height
    );
  }

  const resizeObserver = new ResizeObserver(() => resize());
  resizeObserver.observe(container);
  resize();

  const handleMouseMove = (e) => {
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = 1 - (e.clientY - rect.top) / rect.height;
    mouseRef.x = x;
    mouseRef.y = y;
  };

  const update = (t) => {
    rafId = requestAnimationFrame(update);

    if (pageLoadAnimation && loadAnimationStart === 0) {
      loadAnimationStart = t;
    }

    if (!pause) {
      const elapsed = (t * 0.001 + timeOffset) * timeScale;
      program.uniforms.iTime.value = elapsed;
      frozenTime = elapsed;
    } else {
      program.uniforms.iTime.value = frozenTime;
    }

    if (pageLoadAnimation && loadAnimationStart > 0) {
      const animationDuration = 2000;
      const animationElapsed = t - loadAnimationStart;
      const progress = Math.min(animationElapsed / animationDuration, 1);
      program.uniforms.uPageLoadProgress.value = progress;
    }

    if (mouseReact) {
      const dampingFactor = 0.08;
      smoothMouseRef.x += (mouseRef.x - smoothMouseRef.x) * dampingFactor;
      smoothMouseRef.y += (mouseRef.y - smoothMouseRef.y) * dampingFactor;

      const mouseUniform = program.uniforms.uMouse.value;
      mouseUniform[0] = smoothMouseRef.x;
      mouseUniform[1] = smoothMouseRef.y;
    }

    renderer.render({ scene: mesh });
  };
  rafId = requestAnimationFrame(update);
  container.appendChild(gl.canvas);

  if (mouseReact) {
    container.addEventListener('mousemove', handleMouseMove);
  }

  const setOptions = (newOptions) => {
    if (!program) return;
    if (newOptions.scale !== undefined) program.uniforms.uScale.value = newOptions.scale;
    if (newOptions.gridMul !== undefined) program.uniforms.uGridMul.value = new Float32Array(newOptions.gridMul);
    if (newOptions.digitSize !== undefined) program.uniforms.uDigitSize.value = newOptions.digitSize;
    if (newOptions.scanlineIntensity !== undefined) program.uniforms.uScanlineIntensity.value = newOptions.scanlineIntensity;
    if (newOptions.glitchAmount !== undefined) program.uniforms.uGlitchAmount.value = newOptions.glitchAmount;
    if (newOptions.flickerAmount !== undefined) program.uniforms.uFlickerAmount.value = newOptions.flickerAmount;
    if (newOptions.noiseAmp !== undefined) program.uniforms.uNoiseAmp.value = newOptions.noiseAmp;
    if (newOptions.chromaticAberration !== undefined) program.uniforms.uChromaticAberration.value = newOptions.chromaticAberration;
    if (newOptions.dither !== undefined) program.uniforms.uDither.value = (typeof newOptions.dither === 'boolean' ? (newOptions.dither ? 1 : 0) : newOptions.dither);
    if (newOptions.curvature !== undefined) program.uniforms.uCurvature.value = newOptions.curvature;
    if (newOptions.brightness !== undefined) program.uniforms.uBrightness.value = newOptions.brightness;
    if (newOptions.tint !== undefined) {
      const t = hexToRgb(newOptions.tint);
      program.uniforms.uTint.value = new Color(t[0], t[1], t[2]);
    }
  };

  // Return cleanup function and setter
  return {
    cleanup: () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      if (mouseReact) {
        container.removeEventListener('mousemove', handleMouseMove);
      }
      if (gl.canvas.parentElement === container) {
        container.removeChild(gl.canvas);
      }
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
    setOptions
  };
}
