/**
 * 지역/업종 cat 코드 추출 및 페이지네이션 구조 확인
 */
const puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
        page.on('dialog', async d => { await d.accept(); });

        // 로그인
        await page.goto('https://opga037.com/bbs/login.php', { waitUntil: 'networkidle2', timeout: 30000 });
        await sleep(1500);
        const nav = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 25000 });
        await page.evaluate(() => {
            document.getElementById('login_id').value = 'asdf87a';
            document.getElementById('login_pw').value = 'asdf87a';
            const form = document.querySelector('form[name="flogin"]');
            const r = flogin_submit(form); if (r) form.submit();
        });
        await nav.catch(() => {});
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {});
        await sleep(1500);
        console.log('로그인됨');

        // 메인 업체정보 페이지에서 카테고리(지역) 필터 링크 추출
        await page.goto('https://opga037.com/bbs/board.php?bo_table=op_partner_posting', { waitUntil: 'networkidle2', timeout: 20000 });
        await sleep(2000);

        const catInfo = await page.evaluate(() => {
            // cat 파라미터를 가진 링크 수집 (지역 필터)
            const catLinks = [...document.querySelectorAll('a[href*="cat="]')]
                .map(a => {
                    try {
                        const u = new URL(a.href);
                        return {
                            text: a.textContent.trim(),
                            cat: u.searchParams.get('cat'),
                            cat2: u.searchParams.get('cat2'),
                            href: a.href
                        };
                    } catch(e) { return null; }
                })
                .filter(x => x && x.cat && !x.cat2); // cat만 있는 것 (지역 필터)

            const uniqueCats = [];
            const seen = new Set();
            for (const c of catLinks) {
                if (!seen.has(c.cat)) {
                    seen.add(c.cat);
                    uniqueCats.push(c);
                }
            }

            // 전체 HTML에서 cat 패턴 찾기
            const allHrefs = [...document.querySelectorAll('a[href]')].map(a => a.href);
            const catPattern = allHrefs
                .filter(h => h.includes('cat=') && !h.includes('cat2='))
                .slice(0, 30);

            return { uniqueCats, catPattern };
        });

        console.log('\n=== 지역(cat) 필터 링크 ===');
        console.log('고유 cat 수:', catInfo.uniqueCats.length);
        catInfo.uniqueCats.forEach(c => console.log(`  cat=${c.cat}: ${c.text}`));

        // cat=1 (강남)으로 페이지네이션 테스트
        console.log('\n=== cat=1 (강남) 페이지네이션 테스트 ===');
        for (let p = 1; p <= 3; p++) {
            await page.goto(`https://opga037.com/bbs/board.php?bo_table=op_partner_posting&cat=1&page=${p}`, {
                waitUntil: 'networkidle2', timeout: 20000
            });
            await sleep(1500);

            const result = await page.evaluate((pageNum) => {
                const url = location.href;
                const links = [...document.querySelectorAll('a[href*="wr_id"]')]
                    .filter(a => !a.href.includes('delete') && !a.href.includes('reply'));

                const pageLinks = [...document.querySelectorAll('a[href*="page="]')]
                    .map(a => { try { return parseInt(new URL(a.href).searchParams.get('page')); } catch(e) { return 0; } })
                    .filter(n => n > 0);

                const maxPage = pageLinks.length ? Math.max(...pageLinks) : 1;

                return {
                    url,
                    linkCount: links.length,
                    maxPage,
                    firstLink: links[0] ? links[0].textContent.trim().substring(0, 40) : '',
                };
            }, p);

            console.log(`  p.${p}: ${result.linkCount}개 | 최대페이지: ${result.maxPage} | URL: ${result.url}`);
            console.log(`         첫번째: ${result.firstLink}`);
        }

        // 전체 지역 목록이 있는지 확인 (사이드바나 드롭다운)
        await page.goto('https://opga037.com/bbs/board.php?bo_table=op_partner_posting', { waitUntil: 'networkidle2', timeout: 20000 });
        await sleep(2000);

        const sidebarInfo = await page.evaluate(() => {
            // 숫자가 붙은 링크들 (지역별 업소 수)
            const countLinks = [...document.querySelectorAll('a')]
                .filter(a => /\(\d+\)/.test(a.textContent))
                .map(a => ({ text: a.textContent.trim(), href: a.href }))
                .slice(0, 30);

            // 선택 박스
            const selects = [...document.querySelectorAll('select')]
                .map(s => ({
                    name: s.name,
                    options: [...s.options].map(o => ({ val: o.value, text: o.textContent.trim() }))
                }));

            return { countLinks, selects };
        });

        console.log('\n=== 사이드바 지역 링크 (숫자 포함) ===');
        sidebarInfo.countLinks.forEach(l => console.log(`  ${l.text} → ${l.href}`));

        console.log('\n=== SELECT 박스 ===');
        sidebarInfo.selects.forEach(s => {
            console.log(`  name="${s.name}": ${s.options.slice(0, 5).map(o => `${o.val}=${o.text}`).join(', ')}`);
        });

    } catch(e) {
        console.error('오류:', e.message, e.stack);
    } finally {
        await browser.close();
    }
})();
