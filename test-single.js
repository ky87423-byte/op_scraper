/**
 * scraper.js 의 scrapeDetail 을 단 1건만 호출해 새 정규식 검증.
 * 실행: node test-single.js [wr_id]
 */
const puppeteer = require('puppeteer');
const { login, scrapeDetail, CFG } = require('./scraper');

const WR_ID = process.argv[2] || '209708';

(async () => {
    const browser = await puppeteer.launch({
        headless: false, protocolTimeout: 60000,
        args: ['--no-sandbox', '--disable-setuid-sandbox',
               '--disable-blink-features=AutomationControlled',
               '--start-maximized'],
        defaultViewport: null,
    });
    try {
        const page = await browser.newPage();
        await page.setUserAgent(CFG.userAgent);
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            Object.defineProperty(navigator, 'plugins',   { get: () => [1, 2, 3, 4, 5] });
            Object.defineProperty(navigator, 'languages', { get: () => ['ko-KR', 'ko', 'en-US', 'en'] });
            window.chrome = { runtime: {} };
        });
        page.on('dialog', async d => { console.log('[Dialog]', d.message().substring(0, 80)); await d.accept(); });

        await login(page);

        const item = {
            wr_id: WR_ID,
            url: `https://opga037.com/bbs/board.php?bo_table=op_partner_posting&wr_id=${WR_ID}`,
            cat: '', cat2: '', addrName: '', bizName: '',
        };

        console.log('\n→ scrapeDetail 호출');
        const row = await scrapeDetail(page, item, 1);
        console.log('\n결과:');
        console.log('  company:   ', row.company);
        console.log('  area:      ', row.area);
        console.log('  mainPhoto: ', row.mainPhoto || '(없음)');
        console.log('  photos:    ', row.photos ? row.photos.split(',').length + '장' : '(없음)');
        console.log('  externalId:', row.externalId);
    } catch (e) {
        console.error('오류:', e.message);
    } finally {
        await browser.close();
    }
})();
