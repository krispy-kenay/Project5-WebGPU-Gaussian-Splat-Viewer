struct CameraUniforms {
  view: mat4x4<f32>,
  view_inv: mat4x4<f32>,
  proj: mat4x4<f32>,
  proj_inv: mat4x4<f32>,
  viewport: vec2<f32>,
  focal: vec2<f32>,
};

struct RenderSettings {
    gaussian_scaling: f32,
    sh_deg: f32,
    viewport_x: f32,
    viewport_y: f32,
    alpha_scale: f32,
    gaussian_mode: f32,
};

struct Gaussian {
  pos_opacity: array<u32, 2>,
  rot:         array<u32, 2>,
  scale:       array<u32, 2>,
};

struct Splat {
    //TODO: store information for 2D splat rendering
    center_ndc : vec2<f32>,
    radius : vec2<f32>,
    depth : f32,
    color : vec3<f32>,
    a11 : f32,
    a12 : f32,
    a22 : f32,
    opacity: f32,
};