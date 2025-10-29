import { PointCloud } from '../utils/load';
import preprocessWGSL from '../shaders/preprocess.wgsl';
import renderWGSL from '../shaders/gaussian.wgsl';
import commonWGSL from '../shaders/common.wgsl';
import { get_sorter,c_histogram_block_rows,C } from '../sort/sort';
import { Renderer } from './renderer';

export interface GaussianRenderer extends Renderer {

}

// Utility to create GPU buffers
const createBuffer = (
  device: GPUDevice,
  label: string,
  size: number,
  usage: GPUBufferUsageFlags,
  data?: ArrayBuffer | ArrayBufferView
) => {
  const buffer = device.createBuffer({ label, size, usage });
  if (data) device.queue.writeBuffer(buffer, 0, data);
  return buffer;
};

export default function get_renderer(
  pc: PointCloud,
  device: GPUDevice,
  presentation_format: GPUTextureFormat,
  camera_buffer: GPUBuffer,
  canvas: HTMLCanvasElement
): GaussianRenderer {

  const sorter = get_sorter(pc.num_points, device);
  
  // ===============================================
  //            Initialize GPU Buffers
  // ===============================================

  const nulling_data = new Uint32Array([0]);
  const settings_buffer = createBuffer(device, 'gaussian settings', 32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, new Float32Array([1.0, pc.sh_deg, canvas.width, canvas.height, 1.0, 1.0]));
  const indirect_args = createBuffer(device, 'gaussian indirect args', 4 * 4, GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST, new Uint32Array([6, pc.num_points, 0, 0]));
  const splat_buffer = createBuffer(device, 'gaussian splat', pc.num_points * 48, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST);

  const getSortedIndicesBuffer = () => sorter.ping_pong[sorter.final_out_index].sort_indices_buffer;
  const WORKGROUP_SIZE = 256;
    
  // ===============================================
  //    Create Compute Pipeline and Bind Groups
  // ===============================================
  const preprocess_pipeline = device.createComputePipeline({
    label: 'preprocess',
    layout: 'auto',
    compute: {
      module: device.createShaderModule({ code: commonWGSL + '\n' + preprocessWGSL }),
      entryPoint: 'preprocess',
      constants: {
        workgroupSize: C.histogram_wg_size,
        sortKeyPerThread: c_histogram_block_rows,
      },
    },
  });

  const preprocess_bg0 = device.createBindGroup({
    label: 'preprocess g0',
    layout: preprocess_pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: camera_buffer } },
      { binding: 1, resource: { buffer: settings_buffer } },
    ],
  });

  const preprocess_bg1 = device.createBindGroup({
    label: 'preprocess g1',
    layout: preprocess_pipeline.getBindGroupLayout(1),
    entries: [
      { binding: 0, resource: { buffer: pc.gaussian_3d_buffer } },
      { binding: 1, resource: { buffer: pc.sh_buffer } },
      { binding: 2, resource: { buffer: splat_buffer } },
    ],
  });

  const sort_bind_group = device.createBindGroup({
    label: 'sort',
    layout: preprocess_pipeline.getBindGroupLayout(2),
    entries: [
      { binding: 0, resource: { buffer: sorter.sort_info_buffer } },
      { binding: 1, resource: { buffer: sorter.ping_pong[0].sort_depths_buffer } },
      { binding: 2, resource: { buffer: sorter.ping_pong[0].sort_indices_buffer } },
      { binding: 3, resource: { buffer: sorter.sort_dispatch_indirect_buffer } },
    ],
  });


  // ===============================================
  //    Create Render Pipeline and Bind Groups
  // ===============================================
  const render_shader = device.createShaderModule({ code: commonWGSL + '\n' + renderWGSL });

  const render_pipeline = device.createRenderPipeline({
    label: 'gaussian render',
    layout: 'auto',
    vertex: { module: render_shader, entryPoint: 'vs_main' },
    fragment: {
      module: render_shader,
      entryPoint: 'fs_main',
      targets: [{
        format: presentation_format,
        blend: {
          color : { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          alpha : { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        },
        writeMask: GPUColorWrite.ALL
      }],
    },
    primitive: { topology: 'triangle-list' },
  });

  const render_splat_bg = device.createBindGroup({
    label: 'gaussian splats',
    layout: render_pipeline.getBindGroupLayout(1),
    entries: [{ binding: 0, resource: { buffer: splat_buffer } }],
  });
  const render_sorted_bg = device.createBindGroup({
    label: 'sorted indices',
    layout: render_pipeline.getBindGroupLayout(2),
    entries: [{ binding: 0, resource: { buffer: getSortedIndicesBuffer() } }],
  });
  const render_settings_bg = device.createBindGroup({
    label: 'gaussian settings',
    layout: render_pipeline.getBindGroupLayout(3),
    entries: [{ binding: 0, resource: { buffer: settings_buffer } }],
  });
  

  // ===============================================
  //    Command Encoder Functions
  // ===============================================
  const render_pass = (encoder: GPUCommandEncoder, view: GPUTextureView) => {
    const pass = encoder.beginRenderPass({
      label: 'gaussian quad render',
      colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }],
    });
    pass.setPipeline(render_pipeline);
    pass.setBindGroup(1, render_splat_bg);
    pass.setBindGroup(2, render_sorted_bg);
    pass.setBindGroup(3, render_settings_bg);
    pass.drawIndirect(indirect_args, 0);
    pass.end();
  };
  
  // ===============================================
  //    Preprocessing
  // ===============================================
  const run_preprocess = (encoder: GPUCommandEncoder) => {
    device.queue.writeBuffer(sorter.sort_info_buffer, 0, nulling_data);
    device.queue.writeBuffer(sorter.sort_dispatch_indirect_buffer, 0, nulling_data);
  
    const num = pc.num_points;
    const wg = WORKGROUP_SIZE;
    const num_wg = Math.ceil(num / wg);
    const pass = encoder.beginComputePass({ label: 'preprocess' });
    pass.setPipeline(preprocess_pipeline);
    pass.setBindGroup(0, preprocess_bg0);
    pass.setBindGroup(1, preprocess_bg1);
    pass.setBindGroup(2, sort_bind_group);
    pass.dispatchWorkgroups(num_wg);
    pass.end();
    encoder.copyBufferToBuffer(
      sorter.sort_info_buffer, 0,
      indirect_args, 4,
      4
    );
  };

  // ===============================================
  //    Return Render Object
  // ===============================================
  return {
    frame: (encoder: GPUCommandEncoder, texture_view: GPUTextureView) => {
      run_preprocess(encoder);
      sorter.sort(encoder);
      render_pass(encoder, texture_view);
    },
    camera_buffer,
    setGaussianScale(value: number) {
      device.queue.writeBuffer(settings_buffer, 0, new Float32Array([value]));
    }
  };
}
