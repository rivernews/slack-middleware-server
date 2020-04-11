import {
    S3Client,
    ListObjectsV2Command,
    ListObjectsV2Input,
    GetObjectCommand,
    GetObjectInput
} from '@aws-sdk/client-s3-node';
import { ServerError } from '../../utilities/serverExceptions';
import { Readable } from 'stream';
import { S3Organization } from './types';

// aws sdk js v3
// https://www.npmjs.com/package/@aws-sdk/client-s3-node

// aws sdk error handling
// https://www.npmjs.com/package/@aws-sdk/client-s3-node#troubleshooting

class S3ArchiveManager {
    private static _singleton = new S3ArchiveManager();

    public accessKeyId: string;
    public secretAccessKey: string;
    public bucketRegion = 'us-west-2';
    public bucketName: string;

    private s3Client: S3Client;

    private constructor () {
        if (
            !(
                this.bucketRegion &&
                process.env.AWS_ACCESS_KEY_ID &&
                process.env.AWS_SECRET_ACCESS_KEY &&
                process.env.AWS_S3_ARCHIVE_BUCKET_NAME
            )
        ) {
            throw new Error('AWS credentials not provided');
        }

        this.bucketName = process.env.AWS_S3_ARCHIVE_BUCKET_NAME;
        this.accessKeyId = process.env.AWS_ACCESS_KEY_ID;
        this.secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

        // intiaite s3 client
        this.s3Client = new S3Client({
            region: this.bucketRegion,
            credentials: {
                accessKeyId: this.accessKeyId,
                secretAccessKey: this.secretAccessKey
            }
        });
    }

    public static get singleton () {
        return S3ArchiveManager._singleton;
    }

    // reading string from stream
    // this is required by S3's getObject in order to retrieve object content
    // https://stackoverflow.com/a/58256873/9814131
    private _readS3ObjectContentAsPlainText (stream: Readable) {
        return new Promise<string>((resolve, reject) => {
            const dataChunks: Buffer[] = [];
            stream.on('data', dataChunk =>
                dataChunks.push(dataChunk as Buffer)
            );
            stream.on('end', () =>
                resolve(Buffer.concat(dataChunks).toString('utf-8'))
            );
            stream.on('error', error => reject(error));
        });
    }

    private async _asyncGetObjectContent (key: string) {
        const params: GetObjectInput = {
            Bucket: this.bucketName,
            Key: key
        };
        const res = await this.s3Client.send(new GetObjectCommand(params));

        if (!res.Body) {
            throw new ServerError(
                `While fetching s3 object at key ${key}, an empty value returned. Please check if the object content on S3 is correct, and re-try again.`
            );
        }

        return this._readS3ObjectContentAsPlainText(res.Body);
    }

    /**
     * This method returns a list of keys of either objects or directory, depending on the parameter `onlyDirectory`.
     * @param prefix Specify a prefix to narrow down the objects you want to list
     * @param onlyDirectory If `true`, will only return directory keys, see {@link https://docs.aws.amazon.com/AmazonS3/latest/dev/ListingKeysHierarchy.html|AWS documentation} for more detail; otherwise will return object keys.
     */
    private async _asyncListKeys (prefix: string, onlyDirectory = false) {
        let keyList: string[] = [];

        // aws sdk listObject()
        // paginated results
        // https://stackoverflow.com/a/58756827/9814131
        let ContinuationToken = undefined;
        do {
            const params: ListObjectsV2Input = {
                Bucket: this.bucketName,
                MaxKeys: 100,
                ContinuationToken
            };

            if (onlyDirectory) {
                params.Delimiter = '/';
                if (prefix) {
                    params.Prefix = prefix;
                }
            } else {
                params.Prefix = prefix;
            }

            const res = await this.s3Client.send(
                new ListObjectsV2Command(params)
            );

            keyList = [
                ...keyList,
                ...(res.Contents && !onlyDirectory
                    ? res.Contents.map(s3Object => {
                          if (s3Object.Key === undefined) {
                              console.error(
                                  'S3 objet key is undefined. S3Object:',
                                  s3Object
                              );
                              console.error(
                                  'the original list object request params',
                                  params
                              );
                              throw new ServerError(
                                  `All S3 objects are expected to have key, but key is undefined. See error message above`
                              );
                          }

                          return s3Object.Key;
                      })
                    : []),

                ...(res.CommonPrefixes && onlyDirectory
                    ? res.CommonPrefixes.filter(
                          commonPrefix =>
                              typeof commonPrefix.Prefix === 'string'
                      ).map(commonPrefix => commonPrefix.Prefix as string)
                    : [])
            ];

            ContinuationToken = res.IsTruncated
                ? res.NextContinuationToken
                : undefined;

            console.debug(
                'S3 list url objects: If got continue token, will request next page. ContinuationToken is',
                ContinuationToken
            );
        } while (ContinuationToken);

        return keyList;
    }

    // TODO: remove unused func
    public async asyncGetOverviewPageUrls (): Promise<string[]> {
        // TODO: remove this once finish debugging
        // https://github.com/rivernews/slack-middleware-server/issues/43
        // return [
        //     // 'https://www.glassdoor.com/Overview/Working-at-Pinterest-EI_IE503467.11,20.htm',
        //     'https://www.glassdoor.com/Overview/Working-at-HealthCrowd-EI_IE755450.11,22.htm'
        // ];

        let objectKeys = [];
        objectKeys = await this.asyncListOverviewPageUrlObjectKeys();

        let urls: string[] = [];

        for (const objectKey of objectKeys) {
            // make request to get object content
            urls.push(await this._asyncGetObjectContent(objectKey));
        }

        return urls;
    }

    // TODO: remove unused func
    private async asyncListOverviewPageUrlObjectKeys (): Promise<string[]> {
        return this._asyncListKeys('all-urls');
    }

    public async asyncGetAllOrgsForS3Job () {
        console.log('asyncGetAllOrgsForS3Job()');
        const rootDirectoryKeys = await this._asyncListKeys('', true);

        // e.g. pattern like 'NVIDIA-7633/'
        const orgDirectories = rootDirectoryKeys.filter(key =>
            /-\d+\/$/.test(key)
        );

        const s3Orgs: Array<S3Organization> = [];
        for (const orgDirectory of orgDirectories) {
            const orgMetaObjectKey = `${orgDirectory}meta/latest.json`;
            const reviewsMetaObjectKey = `${orgDirectory}reviews-meta/latest.json`;

            const orgMetaObjectRawString = await this._asyncGetObjectContent(
                orgMetaObjectKey
            );
            const reviewsMetaObjectRawString = await this._asyncGetObjectContent(
                reviewsMetaObjectKey
            );

            const orgMetaObject = JSON.parse(orgMetaObjectRawString);
            const reviewsMetaObject = JSON.parse(reviewsMetaObjectRawString);

            // TODO: implement storing review url in review meta object in java scraper
            // so that we can access it here

            if (
                !(
                    orgMetaObject.companyId &&
                    orgMetaObject.companyName &&
                    orgMetaObject.companyOverviewPageUrl
                )
            ) {
                throw new Error(
                    `S3 getting all orgs: missing required org meta for ${orgDirectory}`
                );
            }

            s3Orgs.push(
                new S3Organization({
                    companyOverviewPageUrl: orgMetaObject.companyOverviewPageUrl as string,
                    orgId: orgMetaObject.companyId as string,
                    orgName: orgMetaObject.companyName as string,

                    reviewPageUrl: reviewsMetaObject.reviewPageUrl as string,
                    localReviewCount: reviewsMetaObject.localReviewCount as number
                })
            );
        }

        return s3Orgs;
    }
}

export const s3ArchiveManager = S3ArchiveManager.singleton;
