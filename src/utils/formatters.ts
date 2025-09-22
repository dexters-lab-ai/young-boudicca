export const formatPrice = (price?: number): string => {
    if (price === null || price === undefined || isNaN(price)) {
        return '$0.00';
    }
    const options: Intl.NumberFormatOptions = {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: price < 1 ? 4 : 2,
        maximumFractionDigits: price < 1 ? 8 : 2,
    };
    return new Intl.NumberFormat('en-US', options).format(price);
};

export const formatNumber = (num?: number | string, decimals = 2): string => {
    if (num === null || num === undefined) return '0';
    const number = typeof num === 'string' ? parseFloat(num) : num;
    if (isNaN(number)) return '0';
    
    if (Math.abs(number) >= 1e9) {
        return (number / 1e9).toFixed(decimals) + 'B';
    }
    if (Math.abs(number) >= 1e6) {
        return (number / 1e6).toFixed(decimals) + 'M';
    }
    if (Math.abs(number) >= 1e3) {
        return (number / 1e3).toFixed(decimals) + 'K';
    }
    return number.toFixed(number < 1 ? 6 : decimals);
};

export const formatPercentage = (num?: number): string => {
    if (num === null || num === undefined || isNaN(num)) return '0.00%';
    return `${num.toFixed(2)}%`;
};

export const formatImageUrl = (url: string, width = 32, height = 32): string => {
    const placeholder = `data:image/svg+xml;charset=UTF-8,%3csvg width='${width}' height='${height}' viewBox='0 0 40 40' xmlns='http://www.w3.org/2000/svg'%3e%3ccircle cx='20' cy='20' r='20' fill='%23444444'/%3e%3c/svg%3e`;
    if (!url) {
        return placeholder;
    }
    
    // Avoid double-proxying if it's already using wsrv.nl
    if (url.startsWith('https://wsrv.nl/')) {
        return url;
    }

    let normalizedUrl = url;
    // Normalize ipfs:// to https gateway before proxying
    if (normalizedUrl.startsWith('ipfs://')) {
        const hash = normalizedUrl.replace('ipfs://', '');
        normalizedUrl = `https://ipfs.io/ipfs/${hash}`;
    }

    if (!normalizedUrl.startsWith('http')) {
        return placeholder;
    }

    const encodedUrl = encodeURIComponent(normalizedUrl);
    return `https://wsrv.nl/?w=${width}&h=${height}&url=${encodedUrl}&dpr=2&quality=80`;
};

export const formatUSD = (value?: number): string => {
    if (value === null || value === undefined || isNaN(value)) return '$0.00';
    
    const formatter = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    });
    
    return formatter.format(value);
};

export const timeAgo = (dateString?: string | number): string => {
    if (!dateString) return 'N/A';
    
    const date = typeof dateString === 'number' ? new Date(dateString) : new Date(dateString);
    const now = new Date();
    const secondsAgo = Math.floor((now.getTime() - date.getTime()) / 1000);
    
    if (isNaN(secondsAgo) || secondsAgo < 0) return 'Invalid date';
    
    // Time periods in seconds
    const minute = 60;
    const hour = minute * 60;
    const day = hour * 24;
    const week = day * 7;
    const month = day * 30;
    const year = day * 365;
    
    if (secondsAgo < minute) {
        return 'just now';
    } else if (secondsAgo < hour) {
        const minutes = Math.floor(secondsAgo / minute);
        return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
    } else if (secondsAgo < day) {
        const hours = Math.floor(secondsAgo / hour);
        return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
    } else if (secondsAgo < week) {
        const days = Math.floor(secondsAgo / day);
        return `${days} ${days === 1 ? 'day' : 'days'} ago`;
    } else if (secondsAgo < month) {
        const weeks = Math.floor(secondsAgo / week);
        return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`;
    } else if (secondsAgo < year) {
        const months = Math.floor(secondsAgo / month);
        return `${months} ${months === 1 ? 'month' : 'months'} ago`;
    } else {
        const years = Math.floor(secondsAgo / year);
        return `${years} ${years === 1 ? 'year' : 'years'} ago`;
    }
};