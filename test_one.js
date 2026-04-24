// 1건만 빠르게 테스트
const puppeteer = require('puppeteer');

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
    const browser = await puppeteer.launch({
        headless: true, protocolTimeout: 60000,
        args: ['--no-sandbox','--disable-setuid-sandbox','--disable-blink-features=AutomationControlled']
    });
    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1366, height: 768 });
        await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator,'webdriver',{get:()=>undefined}); });
        page.on('dialog', async d => { console.log('[Dialog]', d.message().substring(0,80)); await d.accept(); });

        // 로그인
        await page.goto('https://opga037.com/bbs/login.php', { waitUntil:'networkidle2', timeout:30000 });
        await sleep(1500);
        const nav = page.waitForNavigation({ waitUntil:'domcontentloaded', timeout:25000 });
        await page.evaluate(() => {
            document.getElementById('login_id').value = 'asdf87a';
            document.getElementById('login_pw').value = 'asdf87a';
            const form = document.querySelector('form[name="flogin"]');
            const r = flogin_submit(form); if(r) form.submit();
        });
        await nav.catch(()=>{});
        await page.waitForNavigation({ waitUntil:'networkidle2', timeout:20000 }).catch(()=>{});
        await sleep(1500);
        console.log('로그인:', page.url());

        // 상세 페이지 1건 분석
        const testUrl = 'https://opga037.com/bbs/board.php?bo_table=op_partner_posting&wr_id=1000958';
        await sleep(3000);
        await page.goto(testUrl, { waitUntil:'networkidle2', timeout:25000 });
        await sleep(1500);

        const data = await page.evaluate(() => {
            // gnuboard 본문 셀렉터 전수 테스트
            const sels = ['#bo_v_con','#wr_content','.bo_v_con','.view_content','.wr_content','.read_body','.post_content','.board_view'];
            const found = {};
            for(const s of sels) {
                const el = document.querySelector(s);
                found[s] = el ? el.innerText.trim().substring(0,100) : null;
            }

            // 제목
            const titleSels = ['.bo_v_tit','#bo_v_title','h2.bo_title','h2','.view_tit','.title'];
            const titles = {};
            for(const s of titleSels) {
                const el = document.querySelector(s);
                titles[s] = el ? el.innerText.trim().substring(0,100) : null;
            }

            // 전화번호 패턴
            const text = document.body.innerText;
            const phones = text.match(/\b(0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4})\b/g) || [];

            // 이미지
            const imgs = [...document.querySelectorAll('img')]
                .map(i=>i.src)
                .filter(s=>s && /\.(jpg|jpeg|png|gif|webp)/i.test(s) && s.includes('/data/'));

            return {
                contentSels: found,
                titleSels: titles,
                phones: [...new Set(phones)],
                dataImages: imgs.slice(0,10),
                fullText: text.substring(0,2000)
            };
        });

        console.log('\n=== 본문 셀렉터 결과 ===');
        Object.entries(data.contentSels).forEach(([k,v]) => console.log(`  ${k}: ${v ? '"'+v.substring(0,60)+'"' : 'null'}`));
        console.log('\n=== 제목 셀렉터 결과 ===');
        Object.entries(data.titleSels).forEach(([k,v]) => console.log(`  ${k}: ${v ? '"'+v.substring(0,80)+'"' : 'null'}`));
        console.log('\n전화번호:', data.phones);
        console.log('\n이미지(/data/ 경로):', data.dataImages);
        console.log('\n\n--- 전체 텍스트 ---\n', data.fullText);

    } catch(e) { console.error('오류:', e.message); }
    finally { await browser.close(); }
})();
