/**
 * 특정 wr_id 페이지의 모든 이미지 후보를 덤프 (정규식 보강 진단용).
 * 실행: node debug-images.js [wr_id]   (기본: 209708 = ⭐여우⭐)
 */
const puppeteer = require('puppeteer');
const { login, CFG } = require('./scraper');

const WR_ID = process.argv[2] || '209708';
const URL = `https://opga037.com/bbs/board.php?bo_table=op_partner_posting&wr_id=${WR_ID}`;

(async () => {
    const browser = await puppeteer.launch({
        headless: false,
        protocolTimeout: 60000,
        args: [
            '--no-sandbox', '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--start-maximized',
        ],
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
        page.on('dialog', async d => { console.log('[Dialog]', d.message().substring(0, 100)); await d.accept(); });

        await login(page);

        console.log('\n페이지 진입 →', URL);
        await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
        // lazy-load 가 발동하도록 페이지 끝까지 스크롤
        await page.evaluate(async () => {
            await new Promise((res) => {
                let y = 0;
                const t = setInterval(() => {
                    window.scrollBy(0, 400);
                    y += 400;
                    if (y >= document.body.scrollHeight) { clearInterval(t); res(); }
                }, 200);
            });
        });
        await new Promise(r => setTimeout(r, 2000));

        const result = await page.evaluate(() => {
            // 1) 모든 <img> 태그 — src + 흔한 lazy-load 속성 모두
            const imgs = [...document.querySelectorAll('img')].map((i, idx) => ({
                idx,
                src:           i.src || '',
                dataSrc:       i.getAttribute('data-src') || '',
                dataOriginal:  i.getAttribute('data-original') || '',
                dataLazy:      i.getAttribute('data-lazy-src') || i.getAttribute('data-lazy') || '',
                dataEcho:      i.getAttribute('data-echo') || '',
                srcset:        i.getAttribute('srcset') || '',
                className:     i.className || '',
                parentTag:     i.parentElement?.tagName || '',
                width:         i.naturalWidth,
                inBody:        i.closest('.bo_v_con, .write_div, .view_content, #bo_v_con, #bo_v_atc, [id*="content"]') ? true : false,
            }));

            // 2) background-image CSS 가진 요소
            const bgs = [...document.querySelectorAll('*')].slice(0, 5000)
                .filter((e) => {
                    const bg = getComputedStyle(e).backgroundImage;
                    return bg && bg !== 'none' && bg.includes('url(');
                })
                .slice(0, 30)
                .map((e) => ({
                    tag: e.tagName,
                    cls: e.className,
                    bg:  getComputedStyle(e).backgroundImage,
                }));

            // 3) <a href> 로 직접 걸린 이미지 링크
            const links = [...document.querySelectorAll('a[href]')]
                .map(a => a.href)
                .filter(h => /\.(jpg|jpeg|png|gif|webp)/i.test(h))
                .slice(0, 20);

            // 4) 글 본문 컨테이너 후보들
            const containers = [
                '.bo_v_con', '.write_div', '.view_content', '#bo_v_con', '#bo_v_atc',
                '[id*="content"]',
            ].map(sel => ({ sel, found: document.querySelectorAll(sel).length }));

            return { imgs, bgs, links, containers, totalImgs: imgs.length };
        });

        console.log('\n━'.repeat(50));
        console.log(`⭐ wr_id=${WR_ID} 이미지 덤프`);
        console.log('━'.repeat(50));
        console.log(`\n총 <img> 태그: ${result.totalImgs}개\n`);

        result.imgs.forEach((img) => {
            const sources = [];
            if (img.src)          sources.push(`src="${img.src}"`);
            if (img.dataSrc)      sources.push(`data-src="${img.dataSrc}"`);
            if (img.dataOriginal) sources.push(`data-original="${img.dataOriginal}"`);
            if (img.dataLazy)     sources.push(`data-lazy="${img.dataLazy}"`);
            if (img.dataEcho)     sources.push(`data-echo="${img.dataEcho}"`);
            if (img.srcset)       sources.push(`srcset="${img.srcset}"`);
            console.log(`[${img.idx}] ${img.parentTag} <img${img.className ? ` class="${img.className}"` : ''}> body=${img.inBody} w=${img.width}`);
            sources.forEach(s => console.log(`   ${s}`));
        });

        console.log(`\n본문 컨테이너 검출:`);
        result.containers.forEach(c => console.log(`  ${c.sel}: ${c.found}개`));

        if (result.bgs.length > 0) {
            console.log(`\nbackground-image 발견 ${result.bgs.length}건:`);
            result.bgs.slice(0, 10).forEach((b, i) => console.log(`  [${i}] <${b.tag}> ${b.bg.substring(0, 100)}`));
        }
        if (result.links.length > 0) {
            console.log(`\n<a href> 직접 이미지 링크 ${result.links.length}건:`);
            result.links.slice(0, 10).forEach((l, i) => console.log(`  [${i}] ${l}`));
        }

        console.log('\n10초 후 자동 종료... (수동 확인 시간)');
        await new Promise(r => setTimeout(r, 10000));
    } catch (e) {
        console.error('치명적 오류:', e.message);
    } finally {
        await browser.close();
    }
})();
