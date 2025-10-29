@group(3) @binding(0) var<uniform> settings: RenderSettings;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    //TODO: information passed from vertex shader to fragment shader
    @location(0) center_px : vec2<f32>,
    @location(1) half_px   : vec2<f32>,
    @location(2) color     : vec3<f32>,
    @location(3) conicA    : vec3<f32>,
    @location(4) weight    : f32,
};

@group(1) @binding(0) var<storage, read> splats : array<Splat>;
@group(2) @binding(0) var<storage, read> sorted_vis_indices : array<u32>;

@vertex
fn vs_main(
) -> VertexOutput {
    //TODO: reconstruct 2D quad based on information from splat, pass 
    var out: VertexOutput;
    out.position = vec4<f32>(1. ,1. , 0., 1.);
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let d = in.position.xy - in.center_px;
    let a = in.conicA.x;
    let b = in.conicA.y;
    let c = in.conicA.z;
    let t = a * d.x * d.x + 2.0 * b * d.x * d.y + c * d.y * d.y;
    if (t > 9.0) { discard; }
    let alpha = clamp(in.weight * exp(-0.5 * t), 0.0, 1.0);
    
    return vec4<f32>(in.color, alpha);
}