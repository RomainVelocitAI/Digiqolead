// Netlify Function : fetch-email
// Scrape un site web côté serveur (pas de CORS) et extrait les emails

export default async function handler(req) {
    const url = new URL(req.url, 'http://localhost');
    const website = url.searchParams.get('url');

    if (!website) {
        return new Response(JSON.stringify({ email: '', error: 'Missing url parameter' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
    }

    try {
        const email = await scrapeEmail(website);
        return new Response(JSON.stringify({ email }), {
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
    } catch (err) {
        return new Response(JSON.stringify({ email: '', error: err.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
    }
}

// ─── Scraping logic ───

async function scrapeEmail(website) {
    const baseUrl = website.replace(/\/$/, '');

    // Pages à scanner en priorité (les plus probables d'abord)
    const pagesToScan = [
        baseUrl,
        baseUrl + '/contact',
        baseUrl + '/contactez-nous',
        baseUrl + '/nous-contacter',
        baseUrl + '/contact-us',
        baseUrl + '/mentions-legales',
        baseUrl + '/mentions-legales/',
        baseUrl + '/mention-legale',
        baseUrl + '/mentions',
        baseUrl + '/legal',
        baseUrl + '/mentions-legales.html',
        baseUrl + '/a-propos',
        baseUrl + '/about',
        baseUrl + '/impressum',
        baseUrl + '/imprint',
        baseUrl + '/cgv',
        baseUrl + '/cgu',
        baseUrl + '/privacy',
        baseUrl + '/infos',
    ];

    const startTime = Date.now();
    const MAX_TIME = 8500; // Garde-fou à 8.5s (timeout Netlify = 10s)

    for (const pageUrl of pagesToScan) {
        if (Date.now() - startTime > MAX_TIME) break;

        try {
            const resp = await fetch(pageUrl, {
                signal: AbortSignal.timeout(4000),
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.5',
                },
                redirect: 'follow',
            });

            if (!resp.ok) continue;

            const contentType = resp.headers.get('content-type') || '';
            if (!contentType.includes('text/html') && !contentType.includes('text/plain') && !contentType.includes('application/xhtml')) continue;

            const html = await resp.text();
            const email = findEmailInHtml(html);
            if (email) return email;

            // Sur la homepage, découvrir des liens vers contact/legal
            if (pageUrl === baseUrl) {
                const extraPages = findContactLinks(html, baseUrl);
                for (const extraUrl of extraPages) {
                    if (Date.now() - startTime > MAX_TIME) break;
                    if (pagesToScan.includes(extraUrl)) continue;
                    try {
                        const resp2 = await fetch(extraUrl, {
                            signal: AbortSignal.timeout(3000),
                            headers: {
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                                'Accept': 'text/html',
                                'Accept-Language': 'fr-FR,fr;q=0.9',
                            },
                            redirect: 'follow',
                        });
                        if (resp2.ok) {
                            const html2 = await resp2.text();
                            const email2 = findEmailInHtml(html2);
                            if (email2) return email2;
                        }
                    } catch {}
                }
            }
        } catch {
            continue;
        }
    }

    return '';
}

// ─── Email detection ───

function decodeHtmlEntities(text) {
    return text
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
        .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
        .replace(/&commat;/gi, '@')
        .replace(/&period;/gi, '.')
        .replace(/&hyphen;/gi, '-')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"');
}

function decodeCloudflareEmail(html) {
    const emails = [];
    const cfRegex = /data-cfemail=["']([0-9a-fA-F]+)["']/gi;
    let match;
    while ((match = cfRegex.exec(html)) !== null) {
        try {
            const encoded = match[1];
            const key = parseInt(encoded.substr(0, 2), 16);
            let decoded = '';
            for (let i = 2; i < encoded.length; i += 2) {
                decoded += String.fromCharCode(parseInt(encoded.substr(i, 2), 16) ^ key);
            }
            if (decoded.includes('@')) emails.push(decoded);
        } catch {}
    }
    return emails;
}

function deobfuscateEmails(text) {
    return text
        .replace(/\s*\[\s*at\s*\]\s*/gi, '@')
        .replace(/\s*\(\s*at\s*\)\s*/gi, '@')
        .replace(/\s*\[\s*arobase\s*\]\s*/gi, '@')
        .replace(/\s*\(\s*arobase\s*\)\s*/gi, '@')
        .replace(/\s*\[\s*@\s*\]\s*/gi, '@')
        .replace(/\s*\(\s*@\s*\)\s*/gi, '@')
        .replace(/\s*\[\s*dot\s*\]\s*/gi, '.')
        .replace(/\s*\(\s*dot\s*\)\s*/gi, '.')
        .replace(/\s*\[\s*point\s*\]\s*/gi, '.')
        .replace(/\s*\(\s*point\s*\)\s*/gi, '.');
}

function findEmailInHtml(html) {
    let decoded = decodeHtmlEntities(html);
    try { decoded = decodeURIComponent(decoded); } catch {}

    const cfEmails = decodeCloudflareEmail(html);
    const deobfuscated = deobfuscateEmails(decoded);

    const mailtoRegex = /mailto:([\w.\-+]+@[\w.\-]+\.\w{2,})/gi;
    const mailtoMatches = [];
    let m;
    while ((m = mailtoRegex.exec(deobfuscated)) !== null) {
        mailtoMatches.push(m[1]);
    }

    const textMatches = deobfuscated.match(/[\w.\-+]+@[\w.\-]+\.\w{2,}/gi) || [];
    const allMatches = [...cfEmails, ...mailtoMatches, ...textMatches];

    const blacklist = ['example', 'wixpress', 'sentry', 'wordpress', 'gravatar', 'schema.org', 'w3.org',
                       'googleapis', 'google.com', 'gstatic', 'cloudflare', 'jsdelivr', 'placeholder',
                       'email@', 'name@', 'user@', 'info@example', 'test@', 'noreply', 'no-reply',
                       'webpack', 'babel', 'polyfill', 'bootstrap', 'jquery', '.min.js', '.bundle.',
                       'fbcdn', 'facebook', 'twitter', 'instagram'];
    const validTlds = ['.com','.fr','.net','.org','.eu','.io','.co','.info','.de','.uk','.es','.it','.be','.ch','.ca','.re','.nl','.pt','.biz'];

    const seen = new Set();
    for (const email of allMatches) {
        const lower = email.toLowerCase().trim();
        if (seen.has(lower)) continue;
        seen.add(lower);
        if (lower.length > 60 || lower.length < 6) continue;
        if (blacklist.some(b => lower.includes(b))) continue;
        if (!validTlds.some(t => lower.endsWith(t))) continue;
        if (!/^[\w.\-+]+@[\w.\-]+\.\w{2,}$/.test(lower)) continue;
        return lower;
    }
    return '';
}

function findContactLinks(html, baseUrl) {
    const links = [];
    const hrefRegex = /href=["']([^"']*?)["']/gi;
    let match;
    const keywords = ['contact', 'mention', 'legal', 'legale', 'propos', 'about', 'info', 'qui-sommes', 'equipe', 'impressum', 'imprint', 'footer', 'cgv', 'cgu', 'politique', 'privacy'];

    while ((match = hrefRegex.exec(html)) !== null) {
        const href = match[1];
        const lower = href.toLowerCase();
        if (keywords.some(kw => lower.includes(kw))) {
            let fullUrl = href;
            if (href.startsWith('/')) {
                fullUrl = baseUrl + href;
            } else if (!href.startsWith('http')) {
                fullUrl = baseUrl + '/' + href;
            }
            if (fullUrl.startsWith('http') && !fullUrl.includes('mailto:') && !fullUrl.includes('tel:') && !fullUrl.includes('#')) {
                if (!links.includes(fullUrl)) {
                    links.push(fullUrl);
                }
            }
        }
    }
    return links.slice(0, 5);
}

export const config = {
    path: "/.netlify/functions/fetch-email"
};
