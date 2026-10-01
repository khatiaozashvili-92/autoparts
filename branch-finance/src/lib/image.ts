/** ფოტოს დაპატარავება (გრძელი გვერდი ≤ 1600px) და JPEG-ად გადაყვანა */
export async function shrink(file: File, max = 1600): Promise<Blob> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * scale)
  c.height = Math.round(bmp.height * scale)
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  return new Promise((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error('ფოტოს დამუშავება ვერ მოხერხდა'))), 'image/jpeg', 0.85))
}

export const toBase64 = (b: Blob) =>
  new Promise<string>((ok, fail) => {
    const r = new FileReader()
    r.onload = () => ok(String(r.result).split(',')[1])
    r.onerror = () => fail(new Error('read failed'))
    r.readAsDataURL(b)
  })
