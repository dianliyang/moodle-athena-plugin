export default {
  config: [
    {
      key: 'moodleUrl',
      label: 'Moodle Site URL',
      type: 'text',
      placeholder: 'https://moodle.your-university.edu',
      description: 'The base URL of your Moodle site.',
    },
    {
      key: 'token',
      label: 'Web Service Token',
      type: 'text',
      placeholder: 'your-moodle-token',
      description: 'Generate this in Moodle under Profile > Security keys.',
    },
  ],
  async pull(context) {
    const config = (await context.getConfig()) ?? {}
    const { moodleUrl, token } = config

    if (!moodleUrl || !token) {
      return {
        protocolVersion: 'v1',
        courses: [],
        schedules: [],
        sessions: [],
        warnings: ['Moodle site URL or token is missing. Please configure the plugin.'],
      }
    }

    // Mock implementation for now to show structure
    const warnings = ['Moodle sync is currently a placeholder implementation.']

    return {
      protocolVersion: 'v1',
      courses: [
        {
          id: 'moodle-sample-1',
          title: 'Sample Moodle Course',
          code: 'MOODLE101',
          instructors: ['Moodle Admin'],
          url: `${moodleUrl}/course/view.php?id=1`,
          lifecycleState: 'untouched',
        }
      ],
      schedules: [],
      sessions: [],
      warnings,
    }
  },

  async push(_context, payload) {
    return {
      protocolVersion: 'v1',
      summary: {
        courses: payload.courses?.length ?? 0,
        schedules: payload.schedules?.length ?? 0,
        sessions: 0,
      },
      warnings: ['Moodle push is not yet implemented.'],
    }
  },
}
