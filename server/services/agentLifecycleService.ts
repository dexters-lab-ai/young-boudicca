import { agentQueue, redis } from '../queue';

const JOB_REPEAT_INTERVAL = 15 * 1000; // Check every 15 seconds
const INTERACTION_TTL_SECONDS = 60 * 5; // 5 minutes

export class AgentLifecycleService {

    private getJobId(walletAddress: string): string {
        return `autonomy-check:${walletAddress}`;
    }

    async initializeAutonomy(walletAddress: string) {
        const jobId = this.getJobId(walletAddress);
        console.log(`[LifecycleService] Initializing autonomy job: ${jobId}`);

        await this.decommissionAutonomy(walletAddress); // Ensure no duplicates

        await agentQueue.add(
            'autonomy-check',
            { walletAddress },
            {
                jobId,
                repeat: {
                    every: JOB_REPEAT_INTERVAL,
                },
            }
        );

        console.log(`[LifecycleService] Job ${jobId} added to queue.`);
    }

    async decommissionAutonomy(walletAddress: string) {
        const jobId = this.getJobId(walletAddress);
        console.log(`[LifecycleService] Decommissioning autonomy job: ${jobId}`);
        
        const repeatableJobs = await agentQueue.getRepeatableJobs();
        const jobToRemove = repeatableJobs.find(job => job.id === jobId);

        if (jobToRemove) {
            await agentQueue.removeRepeatableByKey(jobToRemove.key);
            console.log(`[LifecycleService] Removed job ${jobId} from queue.`);
        } else {
            console.log(`[LifecycleService] Job ${jobId} not found in queue, nothing to remove.`);
        }
    }
    
    async recordInteraction(walletAddress: string) {
        console.log(`[LifecycleService] Recording interaction for wallet: ${walletAddress}`);
        await redis.set(`lastInteraction:${walletAddress}`, Date.now(), 'EX', INTERACTION_TTL_SECONDS);
    }
}