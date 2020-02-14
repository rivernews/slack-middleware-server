import cheerio from 'cheerio';

const cheerioFindReducer = (
    baseCheerioElement: Cheerio,
    cssSelectorList: string[] = []
) => {
    return cssSelectorList.reduce((accumulated, newSelector) => {
        return accumulated.find(newSelector);
    }, baseCheerioElement);
};

export const cssSelectorListToChainedFindFromHTML = (
    html: string,
    cssSelector = ''
) => {
    const $ = cheerio.load(html);

    const cssSelectorList = cssSelector.split(' ');

    if (!cssSelectorList.length) {
        return $;
    }

    const [firstSelector] = cssSelectorList;

    if (!firstSelector) {
        // not likely to fall in this condition
        // since we already ensure cssSelectorList.length >= 1
        // but just in case
        return $;
    }

    const firstLevelCheerioElement = $(firstSelector);

    const [, ...restSelectorList] = cssSelectorList;

    if (!restSelectorList.length) {
        return firstLevelCheerioElement;
    }

    return cheerioFindReducer(firstLevelCheerioElement);
};

export const cssSelectorToChainedFindFromCheerioElement = (
    cheerioElement: Cheerio,
    cssSelector: string
) => {
    const cssSelectorList = cssSelector.split(' ');
    return cheerioFindReducer(cheerioElement, cssSelectorList);
};
