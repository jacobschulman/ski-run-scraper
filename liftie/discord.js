/**
 * Discord Webhook Notifier
 *
 * Sends notifications to Discord via webhooks.
 */

const config = require('./config');

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

    if (!response.ok) {
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
  await sendDiscordMessage({
    embeds: [{
      title: '🔍 Liftie Investigating Issue',
      color: 0xFFA500, // Orange
      fields: [
        { name: 'Resort', value: issue.resort || 'N/A', inline: true },
        { name: 'Data Type', value: issue.dataType || 'N/A', inline: true },
        { name: 'Issue Type', value: issue.type, inline: true },
        { name: 'Details', value: issue.details || 'No additional details' }
      ],
      timestamp: new Date().toISOString()
    }]
  });
}

/**
 * Notify that an issue was successfully fixed
 */
async function notifyIssueFixed(issue, fix) {
  await sendDiscordMessage({
    embeds: [{
      title: '🎿 Liftie Fixed an Issue',
      color: 0x00FF00, // Green
      fields: [
        { name: 'Resort', value: issue.resort || 'N/A', inline: true },
        { name: 'Data Type', value: issue.dataType || 'N/A', inline: true },
        { name: 'Problem', value: issue.type, inline: false },
        { name: 'Root Cause', value: fix.rootCause || 'Unknown', inline: false },
        { name: 'Fix Applied', value: fix.action, inline: false },
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
  await sendDiscordMessage({
    embeds: [{
      title: '🚨 Liftie Needs Help',
      color: 0xFF0000, // Red
      fields: [
        { name: 'Resort', value: issue.resort || 'N/A', inline: true },
        { name: 'Data Type', value: issue.dataType || 'N/A', inline: true },
        { name: 'Problem', value: issue.type, inline: false },
        { name: 'Details', value: issue.details || 'No additional details', inline: false },
        { name: 'Attempts Made', value: attempts.join('\n') || 'None', inline: false }
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
