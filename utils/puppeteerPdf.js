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

/**
 * Converts a WebP image to PNG buffer using Puppeteer.
 * Useful because PDFKit doesn't support WebP.
 */
async function convertWebPToPng(filePath) {
  let browser;
  try {
    const puppeteer = require('puppeteer');
    const path = require('path');

    // Validate path stays within uploads directory before opening with file:// protocol
    const UPLOADS_BASE = path.resolve(__dirname, '..', 'uploads');
    const absolutePath = path.resolve(UPLOADS_BASE, filePath);

    if (!absolutePath.startsWith(UPLOADS_BASE + path.sep)) {
      throw new Error('Invalid file path: access denied');
    }

    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    
    // Use file:// protocol for local files
    const fileUrl = `file://${absolutePath.replace(/\\/g, '/')}`;
    
    await page.goto(fileUrl);
    
    // Get image dimensions to set viewport
    const dimensions = await page.evaluate(() => {
      const img = document.querySelector('img');
      return {
        width: img.naturalWidth || 800,
        height: img.naturalHeight || 600
      };
    });

    await page.setViewport(dimensions);
    
    const buffer = await page.screenshot({
      type: 'png',
      omitBackground: true
    });

    return buffer;
  } catch (err) {
    console.error('[Puppeteer Image Conversion Error]', err);
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = { renderPdf, convertWebPToPng }
