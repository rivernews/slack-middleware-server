import {
    S3Client,
    S3Configuration,
    ListObjectsV2Command,
    ListObjectsV2Input,
    GetObjectCommand,
    GetObjectInput
} from '@aws-sdk/client-s3-node';
import { ServerError } from '../utilities/serverExceptions';
import { Readable } from 'stream';

// aws sdk js v3
// https://www.npmjs.com/package/@aws-sdk/client-s3-node

// aws sdk error handling
// https://www.npmjs.com/package/@aws-sdk/client-s3-node#troubleshooting

const bucketRegion = 'us-west-2';
const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

if (!(bucketRegion && accessKeyId && secretAccessKey)) {
    throw 'AWS credentials not provided';
}

class S3ArchiveManager {
    private s3Client: S3Client;
    private bucketName: string =
        process.env.AWS_S3_ARCHIVE_BUCKET_NAME ||
        'iriversland-qualitative-org-review-v3';

    constructor (s3Configuration: S3Configuration) {
        // intiaite s3 client
        this.s3Client = new S3Client(s3Configuration);
    }

    // reading string from stream
    // this is required by S3's getObject in order to retrieve object content
    // https://stackoverflow.com/a/58256873/9814131
    private readS3ObjectContentAsPlainText (stream: Readable) {
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
            const params: GetObjectInput = {
                Bucket: this.bucketName,
                Key: objectKey
            };
            const res = await this.s3Client.send(new GetObjectCommand(params));

            if (!res.Body) {
                throw new ServerError(
                    `while fetching overview page urls, an empty value returned. At key ${objectKey}. All object must contain the url of org overview page. Please check the object on S3, and re-try again.`
                );
            }

            urls.push(await this.readS3ObjectContentAsPlainText(res.Body));
        }

        return urls;
    }

    private async asyncListOverviewPageUrlObjectKeys (): Promise<string[]> {
        let keyList: string[] = [];

        console.debug('about to list url objects on s3...');

        // aws sdk listObject()
        // paginated results
        // https://stackoverflow.com/a/58756827/9814131
        let ContinuationToken = undefined;
        do {
            const params: ListObjectsV2Input = {
                Bucket: this.bucketName,
                Prefix: 'all-urls',
                MaxKeys: 100,
                ContinuationToken
            };
            const res = await this.s3Client.send(
                new ListObjectsV2Command(params)
            );

            keyList = [
                ...keyList,
                ...(res.Contents
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
}

export const s3ArchiveManager = new S3ArchiveManager({
    region: bucketRegion,
    credentials: {
        accessKeyId,
        secretAccessKey
    }
});
