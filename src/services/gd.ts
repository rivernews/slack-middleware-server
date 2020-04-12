export const getMiddleReviewPageUrl = (
    reviewPageUrl: string,
    pageNumber: number
) => {
    const middlePattern = /_P\d+\.htm$/;
    if (middlePattern.test(reviewPageUrl)) {
        return reviewPageUrl.replace(middlePattern, `_P${pageNumber}.htm`);
    } else {
        // first review page
        return reviewPageUrl.replace(/\.htm$/, `_P${pageNumber}.htm`);
    }
};
