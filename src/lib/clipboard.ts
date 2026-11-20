/** Copy text to the clipboard; falls back when the Clipboard API is blocked. */
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    return
  } catch {
    /* Clipboard API unavailable (permissions, insecure context, embedded browser). */
  }

  const el = document.createElement('textarea')
  el.value = text
  el.setAttribute('readonly', '')
  el.style.position = 'fixed'
  el.style.left = '-9999px'
  document.body.appendChild(el)
  el.select()
  try {
    if (!document.execCommand('copy')) throw new Error('copy failed')
  } finally {
    document.body.removeChild(el)
  }
}
