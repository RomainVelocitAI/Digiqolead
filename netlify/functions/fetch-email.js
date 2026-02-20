// Netlify Function v1 (CommonJS) : fetch-email
// Scrape un site web côté serveur (pas de CORS) et extrait les emails

exports.handler = async function(event, context) {
    const website = event.queryStringParameters && event.queryStringParameters.url;

    if (!website) {
        return {
            statusCode: 400,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ email: '', error: 'Missing url parameter' })
        };
    }

    try {
        const email = await scrapeEmail(website);
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ email })
        };
    } catch (err) {
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ email: '', error: err.message })
        };
    }
};

// ─── Scraping logic ───

async function scrapeEmail(website) {
    const baseUrl = website.replace(/\/$/, '');

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
    const MAX_TIME = 8500;

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
                    } catch (e) { /* ignore */ }
                }
            }
        } catch (e) {
            continue;
        }
    }

    return '';
}

// ─── Email detection ───

function decodeHtmlEntities(text) {
    return text
        .replace(/&#(\d+);/g, function(_, code) { return String.fromCharCode(parseInt(code, 10)); })
        .replace(/&#x([0-9a-fA-F]+);/g, function(_, code) { return String.fromCharCode(parseInt(code, 16)); })
        .replace(/&commat;/gi, '@')
        .replace(/&period;/gi, '.')
        .replace(/&hyphen;/gi, '-')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"');
}

function decodeCloudflareEmail(html) {
    var emails = [];
    var cfRegex = /data-cfemail=["']([0-9a-fA-F]+)["']/gi;
    var match;
    while ((match = cfRegex.exec(html)) !== null) {
        try {
            var encoded = match[1];
            var key = parseInt(encoded.substr(0, 2), 16);
            var decoded = '';
            for (var i = 2; i < encoded.length; i += 2) {
                decoded += String.fromCharCode(parseInt(encoded.substr(i, 2), 16) ^ key);
            }
            if (decoded.includes('@')) emails.push(decoded);
        } catch (e) { /* ignore */ }
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
    var decoded = decodeHtmlEntities(html);
    try { decoded = decodeURIComponent(decoded); } catch (e) { /* ignore */ }

    var cfEmails = decodeCloudflareEmail(html);
    var deobfuscated = deobfuscateEmails(decoded);

    var mailtoRegex = /mailto:([\w.\-+]+@[\w.\-]+\.\w{2,})/gi;
    var mailtoMatches = [];
    var m;
    while ((m = mailtoRegex.exec(deobfuscated)) !== null) {
        mailtoMatches.push(m[1]);
    }

    var textMatches = deobfuscated.match(/[\w.\-+]+@[\w.\-]+\.\w{2,}/gi) || [];
    var allMatches = [].concat(cfEmails, mailtoMatches, textMatches);

    var blacklist = ['example', 'wixpress', 'sentry', 'wordpress', 'gravatar', 'schema.org', 'w3.org',
                     'googleapis', 'google.com', 'gstatic', 'cloudflare', 'jsdelivr', 'placeholder',
                     'email@', 'name@', 'user@', 'info@example', 'test@', 'noreply', 'no-reply',
                     'webpack', 'babel', 'polyfill', 'bootstrap', 'jquery', '.min.js', '.bundle.',
                     'fbcdn', 'facebook', 'twitter', 'instagram'];
    var validTlds = ['.com','.fr','.net','.org','.eu','.io','.co','.info','.de','.uk','.es','.it','.be','.ch','.ca','.re','.nl','.pt','.biz'];

    var seen = {};
    for (var i = 0; i < allMatches.length; i++) {
        var lower = allMatches[i].toLowerCase().trim();
        if (seen[lower]) continue;
        seen[lower] = true;
        if (lower.length > 60 || lower.length < 6) continue;
        var blocked = false;
        for (var j = 0; j < blacklist.length; j++) {
            if (lower.includes(blacklist[j])) { blocked = true; break; }
        }
        if (blocked) continue;
        var validTld = false;
        for (var k = 0; k < validTlds.length; k++) {
            if (lower.endsWith(validTlds[k])) { validTld = true; break; }
        }
        if (!validTld) continue;
        if (!/^[\w.\-+]+@[\w.\-]+\.\w{2,}$/.test(lower)) continue;
        return lower;
    }
    return '';
}

function findContactLinks(html, baseUrl) {
    var links = [];
    var hrefRegex = /href=["']([^"']*?)["']/gi;
    var match;
    var keywords = ['contact', 'mention', 'legal', 'legale', 'propos', 'about', 'info', 'qui-sommes', 'equipe', 'impressum', 'imprint', 'footer', 'cgv', 'cgu', 'politique', 'privacy'];

    while ((match = hrefRegex.exec(html)) !== null) {
        var href = match[1];
        var lower = href.toLowerCase();
        var found = false;
        for (var i = 0; i < keywords.length; i++) {
            if (lower.includes(keywords[i])) { found = true; break; }
        }
        if (found) {
            var fullUrl = href;
            if (href.startsWith('/')) {
                fullUrl = baseUrl + href;
            } else if (!href.startsWith('http')) {
                fullUrl = baseUrl + '/' + href;
            }
            if (fullUrl.startsWith('http') && !fullUrl.includes('mailto:') && !fullUrl.includes('tel:') && !fullUrl.includes('#')) {
                if (links.indexOf(fullUrl) === -1) {
                    links.push(fullUrl);
                }
            }
        }
    }
    return links.slice(0, 5);
}
