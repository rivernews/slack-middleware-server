import ProgressBar from 'progress';
import Bull from 'bull';
import { toPercentageValue } from '../../utilities/runtime';

// progress
// https://www.npmjs.com/package/progress

export class ProgressBarManager {
    private static PROGRESS_BAR_WIDTH_IN_TERMINAL = 100;

    private progressBar: ProgressBar;
    private job: Bull.Job;
    private jobQueueName: string;

    constructor (
        jobQueueName: string,
        job: Bull.Job,
        total?: number,
        curr?: number
    ) {
        this.job = job;
        this.jobQueueName = jobQueueName;
        this.progressBar = ProgressBarManager.newProgressBar(
            jobQueueName,
            job,
            total,
            curr
        );
    }

    public static newProgressBar (
        jobQueueName: string,
        job: Bull.Job,
        total?: number,
        curr?: number
    ) {
        return new ProgressBar(
            `${jobQueueName} ${job.id}: :percent (:current/:total) [:bar] :rate/s remains :etas elapsed :elapseds\n`,
            {
                width: ProgressBarManager.PROGRESS_BAR_WIDTH_IN_TERMINAL,
                stream: process.stdout,

                curr: curr || 0,
                total: total || 100
            }
        );
    }

    public setCurrent (value: number) {
        this.progressBar.curr = value;
    }

    public setTotal (value: number) {
        this.progressBar.total = value;
    }

    public setAbsolutePercentage (percentageNumber: number) {
        this.progressBar.curr = percentageNumber;
        this.progressBar.total = 100;
        this.progressBar.render();
        return this.job.progress(percentageNumber);
    }

    public setRelativePercentage (currCount: number, totalCount: number) {
        // prefer to use .tick() instead of .render()
        if (
            this.progressBar.curr + 1 === currCount &&
            this.progressBar.total === totalCount
        ) {
            this.progressBar.tick(1);
        } else {
            this.progressBar = ProgressBarManager.newProgressBar(
                this.jobQueueName,
                this.job,
                totalCount,
                currCount
            );
            this.progressBar.render();
        }

        return this.job.progress(toPercentageValue(currCount / totalCount));
    }

    public increment () {
        this.progressBar.tick(1);
        return this.job.progress(
            toPercentageValue(this.progressBar.curr / this.progressBar.total)
        );
    }
}
