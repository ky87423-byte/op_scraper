const puppeteer = require('puppeteer');

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function randDelay() { return sleep(5000 + Math.floor(Math.random()*5000)); }

(async () => {
    const browser = await puppeteer.launch({
        headless: true,
        protocolTimeout: 60000,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    });
    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1366, height: 768 });
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        });
        page.on('dialog', async d => { console.log('[Dialog]', d.message().substring(0,80)); await d.accept(); });

        // ── 로그인 ────────────────────────────────────────────────
        console.log('[1] 로그인...');
        await page.goto('https://opga037.com/bbs/login.php', { waitUntil: 'networkidle2', timeout: 30000 });
        await sleep(1500);

        const nav1 = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 25000 });
        await page.evaluate(() => {
            document.getElementById('login_id').value = 'asdf87a';
            document.getElementById('login_pw').value = 'asdf87a';
            const form = document.querySelector('form[name="flogin"]');
            const ok = flogin_submit(form);
            if (ok) form.submit();
        });
        await nav1.catch(() => {});
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {});
        await sleep(1500);
        console.log('로그인 후 URL:', page.url());

        // ── 메인 페이지 내비게이션 링크 파악 ─────────────────────
        console.log('\n[2] 메인 페이지 네비게이션 분석...');
        await page.goto('https://opga037.com', { waitUntil: 'networkidle2', timeout: 20000 });
        await sleep(1500);

        const navLinks = await page.evaluate(() => {
            return [...document.querySelectorAll('nav a, .gnb a, .menu a, header a, .nav a')]
                .map(a => ({ text: a.innerText.trim(), href: a.href }))
                .filter(a => a.text && a.href && !a.href.includes('#'));
        });
        console.log('내비 링크:', JSON.stringify(navLinks, null, 2));

        // ── board.php 목록 구조 파악 ──────────────────────────────
        console.log('\n[3] 업체정보 게시판 목록 분석...');
        await randDelay();
        await page.goto('https://opga037.com/bbs/board.php?bo_table=op_partner_posting', { waitUntil: 'networkidle2', timeout: 20000 });
        await sleep(2000);

        const boardList = await page.evaluate(() => {
            // 상세 링크 패턴 탐색
            const allLinks = [...document.querySelectorAll('a[href]')]
                .map(a => a.href)
                .filter(h => h.includes('wr_id') || h.includes('view') || h.includes('detail'));

            // 목록 아이템
            const sels = ['ul.list > li', '.list_item', 'tr', '.item', '.post', 'article'];
            let sample = '';
            for (const s of sels) {
                const els = document.querySelectorAll(s);
                if (els.length > 3) {
                    sample = `[${s}] (${els.length}개):\n` + els[0].innerHTML.substring(0, 500);
                    break;
                }
            }

            // 페이지네이션
            const pages = [...document.querySelectorAll('a[href*="page"], a[href*="pg"]')]
                .map(a => ({ text: a.innerText.trim(), href: a.href })).slice(0, 8);

            return {
                allLinks: allLinks.slice(0, 10),
                totalLinks: allLinks.length,
                sampleHtml: sample,
                pagination: pages,
                title: document.title,
                url: location.href,
                fullText: document.body.innerText.substring(0, 1000)
            };
        });
        console.log('board 목록:', JSON.stringify(boardList, null, 2));

        // ── 우리 DB의 post_ids 로 상세 URL 시도 ──────────────────
        // post_ids.txt 에서 가져온 ID들로 실제 URL 패턴 확인
        const testIds = ['1000958', '1001394', '1001507', '1003797'];
        const patterns = [
            id => `https://opga037.com/bbs/board.php?bo_table=op_partner_posting&wr_id=${id}`,
            id => `https://opga037.com/shop/detail.php?wr_id=${id}`,
            id => `https://opga037.com/shop/view.php?wr_id=${id}`,
        ];

        console.log('\n[4] post_id 기반 URL 패턴 테스트...');
        let foundUrl = null;
        outer:
        for (const pattern of patterns) {
            for (const id of testIds) {
                const testUrl = pattern(id);
                await randDelay();
                await page.goto(testUrl, { waitUntil: 'networkidle2', timeout: 20000 });
                await sleep(1000);
                const status = await page.evaluate(() => ({
                    is404: document.title.includes('404') || document.body.innerText.includes('404 Not Found'),
                    title: document.title,
                    hasContent: document.body.innerText.length > 200,
                    url: location.href
                }));
                console.log(`  ${testUrl} → 404:${status.is404} / "${status.title.substring(0,50)}"`);
                if (!status.is404 && status.hasContent) {
                    foundUrl = testUrl;
                    break outer;
                }
            }
        }

        if (!foundUrl) {
            // 목록 링크에서 첫 번째 유효한 링크 시도
            if (boardList.allLinks[0]) {
                foundUrl = boardList.allLinks[0];
                console.log('\n목록에서 발견한 링크 사용:', foundUrl);
            } else {
                console.log('\n유효한 상세 URL을 찾지 못했습니다.');
                return;
            }
        }

        // ── 상세 페이지 구조 분석 ─────────────────────────────────
        console.log('\n[5] 상세 페이지 구조 분석:', foundUrl);
        await page.goto(foundUrl, { waitUntil: 'networkidle2', timeout: 20000 });
        await sleep(2000);

        const detail = await page.evaluate(() => {
            // 이미지
            const imgs = [...document.querySelectorAll('img')]
                .map(i => ({ src: i.src, alt: i.alt, class: i.className }))
                .filter(i => i.src && /\.(jpg|jpeg|png|gif|webp)/i.test(i.src)
                    && !i.src.includes('icon') && !i.src.includes('logo'));

            // 정보 파싱
            const info = {};
            document.querySelectorAll('dl dt').forEach(dt => {
                const dd = dt.nextElementSibling;
                if (dd) info['DL:'+dt.innerText.trim()] = dd.innerText.trim();
            });
            document.querySelectorAll('table tr').forEach(tr => {
                const th = tr.querySelector('th'); const td = tr.querySelector('td');
                if (th && td) info['TB:'+th.innerText.trim()] = td.innerText.trim();
            });
            document.querySelectorAll('.info li, .shop_info li').forEach(li => {
                info['LI:'+li.className] = li.innerText.trim();
            });

            // 내용 영역
            const contentSels = ['.view_content', '.wr_content', '.post_content', '.content', 'article', '.board_view'];
            let contentHtml = '', contentSel = '';
            for (const s of contentSels) {
                const el = document.querySelector(s);
                if (el && el.innerText.length > 50) { contentHtml = el.innerHTML; contentSel = s; break; }
            }

            return {
                url: location.href,
                title: document.title,
                h: [...document.querySelectorAll('h1,h2,h3')].map(e=>e.innerText.trim()).filter(Boolean).slice(0,10),
                images: imgs.slice(0, 20),
                info,
                contentSelector: contentSel,
                contentHtml: contentHtml.substring(0, 1000),
                fullText: document.body.innerText.substring(0, 3000),
                allClasses: [...new Set([...document.querySelectorAll('[class]')]
                    .flatMap(el => (el.className||'').toString().split(' '))
                    .filter(Boolean))].sort().slice(0,80)
            };
        });

        console.log('\n=== 상세 페이지 구조 ===');
        console.log('URL:', detail.url);
        console.log('제목:', detail.title);
        console.log('H태그:', detail.h);
        console.log('\n이미지:', JSON.stringify(detail.images, null, 2));
        console.log('\n정보항목:', JSON.stringify(detail.info, null, 2));
        console.log('\n내용 셀렉터:', detail.contentSelector);
        console.log('내용 HTML:', detail.contentHtml);
        console.log('\nCSS 클래스:', detail.allClasses);
        console.log('\n\n--- 전체 텍스트 (3000자) ---\n', detail.fullText);

    } catch(e) {
        console.error('오류:', e.message, '\n', e.stack);
    } finally {
        await browser.close();
    }
})();
