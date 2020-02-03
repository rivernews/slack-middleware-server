const cheerio = require('cheerio');


const cheerioFindReducer = (baseCheerioElement, cssSelectorList) => {
    return cssSelectorList.reduce((accumulated, newSelector) => {
        return accumulated.find(newSelector);
    }, baseCheerioElement);
}

const cssSelectorListToChainedFindFromHTML = (html, cssSelector = '') => {
    const $ = cheerio.load(html);

    const cssSelectorList = cssSelector.split(' ');
    
    if (!cssSelectorList.length) {
        return $;
    }

    const [firstSelector, ] = cssSelectorList;
    
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

    return cheerioFindReducer(firstLevelCheerioElement, )
}

const cssSelectorToChainedFindFromCheerioElement = (cheerioElement, cssSelector) => {
    const cssSelectorList = cssSelector.split(' ');
    return cheerioFindReducer(cheerioElement, cssSelectorList);
}

module.exports = {
    cssSelectorListToChainedFindFromHTML,
    cssSelectorToChainedFindFromCheerioElement
}
