const puppeteer = require('puppeteer')

async function renderPdf(html) {
  let browser
  try {
    console.log('[Puppeteer] Launching browser...')
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    })
    const page = await browser.newPage()
    
    console.log('[Puppeteer] Setting content...')
    // Using networkidle2 is often more reliable than networkidle0 for external fonts/images
    await page.setContent(html, { waitUntil: 'networkidle2', timeout: 30000 })
    
    console.log('[Puppeteer] Generating PDF...')
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' }
    })
    
    console.log(`[Puppeteer] PDF generated successfully (${pdf.length} bytes)`)
    return pdf
  } catch (err) {
    console.error('[Puppeteer Error]', err)
    throw err
  } finally {
    if (browser) {
      console.log('[Puppeteer] Closing browser...')
      await browser.close()
    }
  }
}

module.exports = { renderPdf }
