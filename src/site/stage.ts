// The glow round the tool. A small WebGL shader paints a slow, pink aura that
// hugs the tool's edge, leans toward the pointer, swells when a file is
// dragged over the page and breathes while a deck is being worked on.
//
// It is decoration only. Without WebGL, with reduced motion, on Save-Data or
// if the GPU drops the context, the still CSS glow in .stage::after stays.

const vertexSource = `
attribute vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
`

const fragmentSource = `
precision mediump float;
uniform vec2 u_res;
uniform float u_time;
uniform vec4 u_rect;
uniform vec2 u_pointer;
uniform float u_energy;
uniform float u_busy;
uniform float u_dark;
uniform float u_scale;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + vec2(17.0, 9.0); a *= 0.5; }
  return v;
}
float box(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }

void main() {
  vec2 px = gl_FragCoord.xy;
  float t = u_time;
  // Distance outside the tool, in CSS pixels.
  float d = box(px - u_rect.xy, u_rect.zw) / u_scale;
  float outside = max(d, 0.0);
  vec2 q = px / u_scale / 260.0;
  float n = fbm(q + vec2(t * 0.035, -t * 0.025));
  float flow = fbm(q * 1.7 - vec2(t * 0.02, t * 0.03) + n);

  float reach = mix(130.0, 230.0, u_energy) * (1.0 + 0.1 * sin(t * 1.4) * u_busy);
  float aura = exp(-outside / reach) * (0.45 + 0.95 * flow);
  float rim = exp(-outside / 16.0) * (0.3 + 0.7 * u_energy);
  float pd = length(px - u_pointer) / u_scale;
  float lamp = exp(-pd * pd / (2.0 * 200.0 * 200.0));

  vec3 soft = vec3(0.969, 0.639, 0.827);
  vec3 pink = vec3(0.824, 0.271, 0.600);
  vec3 hot = vec3(0.937, 0.416, 0.729);
  vec3 colour = mix(soft, pink, clamp(n * 1.3 - 0.1, 0.0, 1.0));
  colour = mix(colour, hot, clamp(rim, 0.0, 1.0));

  float strength = mix(0.26, 0.4, u_dark);
  float a = aura * strength + rim * 0.22 + lamp * mix(0.10, 0.16, u_dark);
  a *= 1.0 + 0.7 * u_energy + 0.3 * u_busy * (0.5 + 0.5 * sin(t * 2.0));
  a *= smoothstep(-2.0, 6.0, d);
  // Fade out before the stage's own edges, so nothing ends in a hard line.
  a *= smoothstep(0.0, 140.0 * u_scale, px.y) * smoothstep(0.0, 40.0 * u_scale, u_res.y - px.y);
  // A little grain, so the gradient never bands.
  a += (hash(px + fract(t) * 31.0) - 0.5) * (3.0 / 255.0);
  a = clamp(a, 0.0, 0.8);
  gl_FragColor = vec4(colour * a, a);
}
`

const RESOLUTION = 0.5

export function setUpStage() {
  const stage = document.querySelector<HTMLElement>('.stage')
  const tool = document.querySelector<HTMLElement>('#emd-root')
  if (!stage || !tool) return
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true
  if (saveData) return

  const canvas = document.createElement('canvas')
  canvas.className = 'stage-canvas'
  canvas.setAttribute('aria-hidden', 'true')
  let gl: WebGLRenderingContext | null = null
  try {
    gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' })
  } catch { gl = null }
  if (!gl) return

  const compile = (type: number, source: string) => {
    const shader = gl!.createShader(type)!
    gl!.shaderSource(shader, source)
    gl!.compileShader(shader)
    return gl!.getShaderParameter(shader, gl!.COMPILE_STATUS) ? shader : null
  }
  const vertex = compile(gl.VERTEX_SHADER, vertexSource)
  const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource)
  if (!vertex || !fragment) return
  const program = gl.createProgram()!
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return
  gl.useProgram(program)

  const buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const position = gl.getAttribLocation(program, 'a_position')
  gl.enableVertexAttribArray(position)
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
  const uniform = (name: string) => gl!.getUniformLocation(program, name)
  const u = {
    res: uniform('u_res'), time: uniform('u_time'), rect: uniform('u_rect'), pointer: uniform('u_pointer'),
    energy: uniform('u_energy'), busy: uniform('u_busy'), dark: uniform('u_dark'), scale: uniform('u_scale'),
  }

  stage.prepend(canvas)

  let width = 0
  let height = 0
  const resize = () => {
    width = Math.max(1, Math.round(stage.clientWidth * RESOLUTION))
    height = Math.max(1, Math.round(stage.clientHeight * RESOLUTION))
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
      gl!.viewport(0, 0, width, height)
    }
  }

  // The pointer, eased, in canvas pixels. It rests on the tool when it's away.
  let pointerTarget: [number, number] | null = null
  let pointer: [number, number] | null = null
  let energy = 0
  let busy = 0
  let running = false
  let visible = true
  let lost = false
  let frame = 0
  let last = 0
  const start = performance.now()

  const draw = (now: number, still: boolean) => {
    resize()
    const stageBox = stage.getBoundingClientRect()
    const toolBox = tool.getBoundingClientRect()
    const cx = (toolBox.left + toolBox.width / 2 - stageBox.left) * RESOLUTION
    const cy = (stageBox.bottom - (toolBox.top + toolBox.height / 2)) * RESOLUTION
    const home: [number, number] = [cx, cy]
    const target = pointerTarget ?? home
    if (!pointer || still) pointer = [...target]
    else pointer = [pointer[0] + (target[0] - pointer[0]) * 0.08, pointer[1] + (target[1] - pointer[1]) * 0.08]

    const dragging = document.querySelector('.emd--dragging, .dropzone--hover') !== null
    const stageName = tool.querySelector<HTMLElement>('.emd')?.dataset.stage ?? 'idle'
    const working = /^(reading|compressing|splitting|flattening)$/.test(stageName)
    const ready = stageName === 'ready'
    const energyTarget = dragging ? 1 : ready ? 0.45 : 0
    energy = still ? energyTarget : energy + (energyTarget - energy) * 0.08
    busy = still ? (working ? 1 : 0) : busy + ((working ? 1 : 0) - busy) * 0.05

    gl!.uniform2f(u.res, width, height)
    gl!.uniform1f(u.time, still ? 12 : (now - start) / 1000)
    gl!.uniform4f(u.rect, cx, cy, (toolBox.width / 2) * RESOLUTION, (toolBox.height / 2) * RESOLUTION)
    gl!.uniform2f(u.pointer, pointer[0], pointer[1])
    gl!.uniform1f(u.energy, energy)
    gl!.uniform1f(u.busy, busy)
    gl!.uniform1f(u.dark, document.documentElement.dataset.resolvedTheme === 'dark' ? 1 : 0)
    gl!.uniform1f(u.scale, RESOLUTION)
    gl!.clearColor(0, 0, 0, 0)
    gl!.clear(gl!.COLOR_BUFFER_BIT)
    gl!.drawArrays(gl!.TRIANGLES, 0, 3)
  }

  const tick = (now: number) => {
    if (!running) return
    frame = requestAnimationFrame(tick)
    // About 30 frames a second, fewer while the engine is busy with the deck.
    const gap = busy > 0.5 ? 66 : 33
    if (now - last < gap) return
    last = now
    draw(now, false)
  }
  const still = () => { if (!lost) draw(performance.now(), true) }
  const update = () => {
    const shouldRun = visible && !document.hidden && !reducedMotion.matches && !lost
    if (shouldRun && !running) { running = true; last = 0; frame = requestAnimationFrame(tick) }
    if (!shouldRun && running) { running = false; cancelAnimationFrame(frame) }
    if (!running) still()
  }

  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault()
    lost = true
    running = false
    cancelAnimationFrame(frame)
    stage.classList.remove('stage--gl')
  })

  window.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse') return
    const box = stage.getBoundingClientRect()
    if (event.clientY < box.top || event.clientY > box.bottom) { pointerTarget = null; return }
    pointerTarget = [(event.clientX - box.left) * RESOLUTION, (box.bottom - event.clientY) * RESOLUTION]
  }, { passive: true })
  document.documentElement.addEventListener('pointerleave', () => { pointerTarget = null })

  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; update() }).observe(stage)
  new ResizeObserver(() => { if (!running) still() }).observe(stage)
  new ResizeObserver(() => { if (!running) still() }).observe(tool)
  new MutationObserver(() => { if (!running) still() }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-resolved-theme'] })
  document.addEventListener('visibilitychange', update)
  reducedMotion.addEventListener('change', update)

  still()
  stage.classList.add('stage--gl')
  update()
}
