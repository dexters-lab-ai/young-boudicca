export type BrowserName = 'Chrome' | 'Firefox' | 'Safari' | 'Edge' | 'Opera' | 'Unknown';

export const GENAI_DOMAIN = 'generativelanguage.googleapis.com';
export const CHROME_WILDCARD_DOMAIN = '[*.]googleapis.com';

export const getBrowserInfo = (): { name: BrowserName; isChromium: boolean } => {
    const ua = navigator.userAgent;
    let name: BrowserName = 'Unknown';
    let isChromium = false;

    if (/(Edg)/.test(ua)) {
        name = 'Edge';
        isChromium = true;
    } else if (/Opera|OPR\//.test(ua)) {
        name = 'Opera';
        isChromium = true;
    } else if (/CriOS|Chrome/.test(ua)) {
        name = 'Chrome';
        isChromium = true;
    } else if (/Safari/.test(ua) && !/Chrome/.test(ua)) {
        name = 'Safari';
    } else if (/Firefox/.test(ua)) {
        name = 'Firefox';
    }
    
    if (!isChromium && (window as any).chrome) {
        isChromium = true;
    }

    return { name, isChromium };
};
