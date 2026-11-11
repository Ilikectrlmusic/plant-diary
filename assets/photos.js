const MAX_BYTES = 25 * 1024 * 1024;
function canvasBlob(canvas, quality) {
  return new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('照片转换失败，请尝试 JPG、PNG 或 WebP 格式。')), 'image/jpeg', quality));
}
function base64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(new Error('无法读取照片，请重新选择。'));
    reader.readAsDataURL(blob);
  });
}
export async function preparePhoto(file) {
  if (!file || !['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'].includes(file.type)) throw new Error('请选择 JPG、PNG、WebP、AVIF 或 GIF 照片。iPhone 请先将 HEIC 转换为 JPG。');
  if (file.size > MAX_BYTES) throw new Error('照片请小于 25 MB，压缩后再试一次。');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > 100000000) throw new Error('照片尺寸过大，请缩小后再上传。');
    const make = async max => {
      const scale = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#f7f6ef';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvasBlob(canvas, max === 1600 ? 0.85 : 0.78);
    };
    const full = await make(1600);
    const thumb = await make(360);
    return { full: await base64(full), thumb: await base64(thumb), preview: URL.createObjectURL(full) };
  } catch (error) {
    if (error.message.includes('尺寸')) throw error;
    throw new Error('这张照片暂时无法解码，请尝试使用 JPG、PNG 或 WebP 文件。');
  } finally { URL.revokeObjectURL(url); }
}
