'use client'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const BUCKET = 'product-types'

const files = [
  'butter.png',
  'cheese.png',
  'chocolate_bar.png',
  'drink_can.png',
  'cola_bottle.png',
  'alcohol_bottle.png',
  'cream.png',
  'chicken_meat.png',
  'beer.png',
  'mandarins.png',
  'grapes.png',
  'placeholder.png',
]

function publicImageUrl(file: string) {
  const clean = String(file)
    .replace(/^\/+/, '')
    .replace(/^product-types\/+/, '')
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${clean}`
}

export default function ProductTypesGalleryPage() {
  return (
    <main style={{ padding: 24 }}>
      <h1>Galerie product-types</h1>
      <p>Supabase Storage</p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
          gap: 16,
          marginTop: 24,
        }}
      >
        {files.map((file) => {
          const url = publicImageUrl(file)

          return (
            <div
              key={file}
              style={{
                border: '1px solid #ddd',
                borderRadius: 8,
                padding: 12,
              }}
            >
              <img
                src={url}
                alt={file}
                style={{ width: '100%', height: 140, objectFit: 'contain' }}
                onError={(e) => {
                  const target = e.currentTarget
                  target.style.display = 'none'
                  const msg = target.nextElementSibling as HTMLElement | null
                  if (msg) msg.style.display = 'block'
                }}
              />
              <div
                style={{
                  display: 'none',
                  color: 'red',
                  fontWeight: 700,
                  marginTop: 8,
                }}
              >
                Nenalezeno
              </div>
              <div style={{ marginTop: 8, fontSize: 14 }}>{file}</div>
              <div style={{ marginTop: 6, fontSize: 12, wordBreak: 'break-all', opacity: 0.7 }}>
                {url}
              </div>
            </div>
          )
        })}
      </div>
    </main>
  )
}
