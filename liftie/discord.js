/**
 * Discord Webhook Notifier
 *
 * Sends notifications to Discord via webhooks.
 */

const config = require('./config');

// Rate limiting - minimum 2 seconds between messages
let lastMessageTime = 0;
const MIN_MESSAGE_INTERVAL = 2000;

/**
 * Send a message to Discord via webhook
 * @param {Object} options
 * @param {string} options.content - Plain text content (optional)
 * @param {Array} options.embeds - Array of embed objects (optional)
 */
async function sendDiscordMessage({ content, embeds }) {
  const webhookUrl = config.discord.webhookUrl;

  if (!webhookUrl) {
    console.log('[Discord] No webhook URL configured, skipping notification');
    return;
  }

  // Rate limiting - wait if we sent a message recently
  const now = Date.now();
  const timeSinceLastMessage = now - lastMessageTime;
  if (timeSinceLastMessage < MIN_MESSAGE_INTERVAL) {
    const waitTime = MIN_MESSAGE_INTERVAL - timeSinceLastMessage;
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  lastMessageTime = Date.now();

  const payload = {
    username: 'Liftie',
    avatar_url: 'https://em-content.zobj.net/source/apple/391/skier_26f7-fe0f.png'
  };

  if (content) payload.content = content;
  if (embeds) payload.embeds = embeds;

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (response.status === 429) {
      // Rate limited - wait and retry once
      const retryAfter = parseInt(response.headers.get('retry-after') || '5', 10) * 1000;
      console.log(`[Discord] Rate limited, waiting ${retryAfter}ms...`);
      await new Promise(resolve => setTimeout(resolve, retryAfter));
      // Don't retry to avoid infinite loops - just log
      console.log('[Discord] Skipping message after rate limit');
    } else if (!response.ok) {
      console.error(`[Discord] Webhook failed: ${response.status} ${response.statusText}`);
    }
  } catch (error) {
    console.error(`[Discord] Webhook error: ${error.message}`);
  }
}

/**
 * Notify that an issue was detected and is being investigated
 */
async function notifyIssueDetected(issue) {
  const resortName = issue.resort || 'Unknown';
  const dataType = issue.dataType || 'data';

  await sendDiscordMessage({
    embeds: [{
      title: `🔍 ${resortName}: Investigating ${dataType} issue`,
      color: 0xFFA500, // Orange
      description: issue.details || 'No additional details',
      fields: [
        { name: 'Issue Type', value: issue.type, inline: true },
        { name: 'Severity', value: issue.severity || 'unknown', inline: true }
      ],
      timestamp: new Date().toISOString()
    }]
  });
}

/**
 * Notify that an issue was successfully fixed
 */
async function notifyIssueFixed(issue, fix) {
  const resortName = issue.resort || 'Unknown';
  const dataType = issue.dataType || 'data';

  await sendDiscordMessage({
    embeds: [{
      title: `✅ ${resortName}: Fixed ${dataType} issue`,
      color: 0x00FF00, // Green
      description: fix.action || 'Issue resolved',
      fields: [
        { name: 'Problem', value: issue.type, inline: true },
        ...(fix.commit ? [{ name: 'Commit', value: `\`${fix.commit}\``, inline: true }] : [])
      ],
      timestamp: new Date().toISOString()
    }]
  });
}

/**
 * Notify that an issue could not be fixed and needs human attention
 */
async function notifyNeedsHelp(issue, attempts) {
  const resortName = issue.resort || 'Unknown';
  const dataType = issue.dataType || 'data';

  await sendDiscordMessage({
    embeds: [{
      title: `🚨 ${resortName}: ${dataType} needs help`,
      color: 0xFF0000, // Red
      description: issue.details || 'No additional details',
      fields: [
        { name: 'Problem', value: issue.type, inline: true },
        { name: 'What was tried', value: attempts.join('\n') || 'None', inline: false }
      ],
      timestamp: new Date().toISOString()
    }]
  });
}

/**
 * Send a daily summary report
 */
async function notifyDailySummary({ healthy, issuesFixed, issuesPending, uptime }) {
  const statusEmoji = healthy ? '✅' : '⚠️';
  const statusText = healthy ? 'All systems healthy' : 'Some issues pending';

  await sendDiscordMessage({
    embeds: [{
      title: '📊 Liftie Daily Report',
      color: healthy ? 0x00FF00 : 0xFFA500,
      fields: [
        { name: 'Status', value: `${statusEmoji} ${statusText}`, inline: false },
        { name: 'Issues Fixed Today', value: issuesFixed.length > 0
          ? issuesFixed.map(i => `• ${i.resort}/${i.dataType}: ${i.action}`).join('\n')
          : 'None', inline: false },
        ...(issuesPending.length > 0 ? [{
          name: 'Pending Issues',
          value: issuesPending.map(i => `• ${i.resort}/${i.dataType}: ${i.type}`).join('\n'),
          inline: false
        }] : []),
        { name: 'Uptime', value: `${uptime}%`, inline: true }
      ],
      timestamp: new Date().toISOString()
    }]
  });
}

/**
 * Send a simple status update
 */
async function notifyStatus(message, level = 'info') {
  const colors = {
    info: 0x0099FF,
    success: 0x00FF00,
    warning: 0xFFA500,
    error: 0xFF0000
  };

  await sendDiscordMessage({
    embeds: [{
      description: message,
      color: colors[level] || colors.info,
      timestamp: new Date().toISOString()
    }]
  });
}

module.exports = {
  sendDiscordMessage,
  notifyIssueDetected,
  notifyIssueFixed,
  notifyNeedsHelp,
  notifyDailySummary,
  notifyStatus
};
