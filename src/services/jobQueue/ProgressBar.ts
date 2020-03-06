import ProgressBar from 'progress';
import Bull from 'bull';
import { toPercentageValue } from '../../utilities/runtime';

// progress
// https://www.npmjs.com/package/progress

export class ProgressBarManager {
    private static PROGRESS_BAR_WIDTH_IN_TERMINAL = 100;

    private progressBar: ProgressBar;
    private job: Bull.Job;

    constructor (
        jobQueueName: string,
        job: Bull.Job,
        total?: number,
        curr?: number
    ) {
        this.job = job;

        this.progressBar = new ProgressBar(
            `${jobQueueName} ${job.id}:percent (:current/:total) [:bar] :rate/s remains :etas elapsed :elapseds\n`,
            {
                width: ProgressBarManager.PROGRESS_BAR_WIDTH_IN_TERMINAL,

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

    public setAbsolutePercentage (value: number) {
        this.progressBar.curr = value;
        this.progressBar.total = 100;
        this.progressBar.render();
        return this.job.progress(toPercentageValue(value / 100));
    }

    public setRelativePercentage (curr: number, total: number) {
        this.progressBar.total = total;

        // prefer to use .tick() instead of .render()
        if (this.progressBar.curr + 1 === curr) {
            this.progressBar.tick(1);
        } else {
            this.progressBar.curr = curr;
            this.progressBar.render();
        }

        return this.job.progress(toPercentageValue(curr / total));
    }

    public increment () {
        this.progressBar.tick(1);
        return this.job.progress(
            toPercentageValue(this.progressBar.curr / this.progressBar.total)
        );
    }
}
