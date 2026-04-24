// scraper.js 로직으로 1건 테스트 (이미지 실제 다운로드 포함)
const puppeteer = require('puppeteer');
const fs   = require('fs');
const path = require('path');

const imageDir = path.join(__dirname, 'scraped_images');
const dataDir  = path.join(__dirname, 'scraped_data');
[imageDir, dataDir].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

const UA    = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Puppeteer 페이지 세션을 이용해 이미지 다운로드 (쿠키 자동 포함)
async function downloadImageWithPage(page, imgUrl, destPath) {
    if (fs.existsSync(destPath)) return { ok: true, reason: 'cached' };
    try {
        const result = await page.evaluate(async (url) => {
            try {
                const res = await fetch(url, { credentials: 'include' });
                if (!res.ok) return { ok: false, status: res.status };
                const ab  = await res.arrayBuffer();
                // Uint8Array → number[] (Node.js로 전달 가능)
                return { ok: true, data: Array.from(new Uint8Array(ab)) };
            } catch(e) { return { ok: false, reason: e.message }; }
        }, imgUrl);

        if (!result.ok) return result;
        fs.writeFileSync(destPath, Buffer.from(result.data));
        return { ok: true, size: result.data.length };
    } catch(e) {
        return { ok: false, reason: e.message };
    }
}

(async () => {
    const browser = await puppeteer.launch({
        headless: true, protocolTimeout: 60000,
        args: ['--no-sandbox','--disable-setuid-sandbox','--disable-blink-features=AutomationControlled']
    });
    try {
        const page = await browser.newPage();
        await page.setUserAgent(UA);
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
        const loggedIn = await page.evaluate(()=>!!document.querySelector('a[href*="logout"]'));
        console.log('로그인:', loggedIn);
        if (!loggedIn) { console.log('로그인 실패'); return; }

        // 테스트 업소 (wr_id=1000958)
        const item = { wr_id: '1000958', url: 'https://opga037.com/bbs/board.php?bo_table=op_partner_posting&wr_id=1000958', addrName: '대구', bizName: '방석집' };

        await sleep(3000);
        await page.goto(item.url, { waitUntil:'networkidle2', timeout:25000 });
        await sleep(1000);

        const raw = await page.evaluate(() => {
            const fullText = document.body.innerText;

            // 업소 제목: [지역-업소명] 패턴 (하이픈 필수 → 공지사항 [안내], [공지] 제외)
            const titleMatch = fullText.match(/(\[[가-힣a-zA-Z0-9\s★⭐*]+[-][가-힣a-zA-Z0-9\s★⭐*]+\][^\n]*)/);
            const title = titleMatch ? titleMatch[1].trim() : '';

            // 글쓴이(업소명): 제목 다음에 나오는 짧은 텍스트
            // 패턴: "[지역-업소명]...\n   업소명   댓글수   조회수"
            const authorMatch = fullText.match(/\[[^\]]*-[^\]]*\][^\n]*\n[\s　]*([^\n\s][^\n]*?)\s{2,}\d/);
            const author = authorMatch ? authorMatch[1].trim() : '';

            // 이미지: /data/editor/ 경로만 (실제 업소 이미지)
            const imgUrls = [...new Set(
                [...document.querySelectorAll('img')]
                    .map(i => i.src)
                    .filter(s => s && s.includes('/data/editor/') && /\.(jpg|jpeg|png|gif|webp)/i.test(s))
            )];

            // 전화번호 (중복 제거)
            const allPhones = [...new Set((fullText.match(/\b(0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4})\b/g)||[]))];
            const hphones   = allPhones.filter(p => p.replace(/\D/g,'').startsWith('010'));
            const phones    = allPhones.filter(p => !p.replace(/\D/g,'').startsWith('010'));

            // 가격 (N만원)
            const priceMatch = fullText.match(/(\d{1,3})\s*만\s*원/);

            // 영업시간
            const timeMatch = fullText.match(/(\d{1,2}:\d{2})\s*[~\-]\s*(\d{1,2}:\d{2})/);

            // 24시간 영업
            const timeFull = fullText.includes('24시') ? 1 : 0;

            return {
                title, author, imgUrls,
                phone:  phones[0]  || hphones[0] || allPhones[0] || '',
                hphone: hphones[0] || '',
                price:  priceMatch ? parseInt(priceMatch[1]) * 10000 : 0,
                time1:  timeMatch ? timeMatch[1] : '',
                time2:  timeMatch ? timeMatch[2] : '',
                timeFull,
            };
        });

        console.log('\n=== 추출 결과 ===');
        console.log('제목:', raw.title);
        console.log('업소명:', raw.author);
        console.log('전화:', raw.phone);
        console.log('휴대폰:', raw.hphone);
        console.log('가격:', raw.price + '원');
        console.log('영업시간:', raw.time1, '~', raw.time2);
        console.log('24시:', raw.timeFull);
        console.log('이미지 수:', raw.imgUrls.length);

        // 제목에서 업소명/지역 파싱
        const titleBracket = (raw.title.match(/^\[([^\]]+)\]/) || [])[1] || '';
        const dashIdx = titleBracket.indexOf('-');
        const titleArea = item.addrName || (dashIdx > -1 ? titleBracket.substring(0, dashIdx).trim() : '');
        const company   = raw.author   || (dashIdx > -1 ? titleBracket.substring(dashIdx + 1).trim() : titleBracket);
        const area      = titleArea ? titleArea + ',' : '';

        console.log('\n=== 파싱 결과 ===');
        console.log('업소명(최종):', company);
        console.log('지역(최종):', area);

        // 이미지 다운로드 (Puppeteer fetch 방식)
        console.log('\n=== 이미지 다운로드 ===');
        const saved = [];
        for (let i = 0; i < raw.imgUrls.length; i++) {
            const imgUrl = raw.imgUrls[i];
            const ext    = (imgUrl.match(/\.(gif|jpg|jpeg|png|webp)/i) || ['.jpg'])[0].toLowerCase();
            const fname  = `${item.wr_id}_${i + 1}${ext}`;
            const dest   = path.join(imageDir, fname);
            const result = await downloadImageWithPage(page, imgUrl, dest);
            const kb     = result.size ? Math.round(result.size / 1024) + 'KB' : '';
            console.log(`  ${fname}: ${result.ok ? '✓ ' + kb : '✗ ' + (result.status || result.reason || '')}`);
            if (result.ok) saved.push(`/images/imgs/${fname}`);
        }

        console.log('\n=== SQL 미리보기 ===');
        const esc = s => String(s||'').replace(/'/g,"\\'").replace(/\n/g,'\\n');
        const subject = raw.title.replace(/^\[[^\]]+\]\s*/,'').substring(0,200);
        const contentHtml = saved.map(p=>`<img src="${p}">`).join('\n');
        console.log(`업소명: ${company}`);
        console.log(`지역: ${area}`);
        console.log(`제목: ${subject.substring(0,60)}`);
        console.log(`전화: ${raw.phone}`);
        console.log(`가격: ${raw.price}원`);
        console.log(`대표이미지: ${saved[0]||''}`);
        console.log(`이미지 수: ${saved.length}개`);

        const sql = `INSERT INTO nf_shop (wr_company,wr_subject,wr_content,wr_area,wr_phone,wr_hphone,wr_price,wr_main_photo,wr_photo,time1,time2,time_full,wr_wdate) VALUES ('${esc(company)}','${esc(subject)}','${esc(contentHtml)}','${esc(area)}','${esc(raw.phone)}','${esc(raw.hphone)}',${raw.price},'${esc(saved[0]||'')}','${esc(saved.slice(1).join(','))}','${esc(raw.time1)}','${esc(raw.time2)}',${raw.timeFull},NOW());`;
        console.log('\nSQL:\n', sql.substring(0, 300) + '...');

        console.log('\n✔ 테스트 완료');
        console.log('이미지 저장:', imageDir);
        const imgFiles = fs.readdirSync(imageDir).filter(f=>f.startsWith(item.wr_id));
        console.log('저장된 파일:', imgFiles);

    } catch(e) { console.error('오류:', e.message, '\n', e.stack); }
    finally { await browser.close(); }
})();
