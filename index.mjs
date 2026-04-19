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

    const cleanUrl = moodleUrl.replace(/\/$/, '')
    const apiUrl = `${cleanUrl}/webservice/rest/server.php`

    try {
      // Get user's courses
      const response = await context.fetch({
        url: `${apiUrl}?wstoken=${token}&wsfunction=core_enrol_get_users_courses&moodlewsrestformat=json`,
        method: 'GET',
      })

      if (response.status !== 200) {
        throw new Error(`Moodle API returned status ${response.status}`)
      }

      const moodleCourses = JSON.parse(response.bodyText)
      
      if (moodleCourses.exception) {
        throw new Error(`Moodle Error: ${moodleCourses.message}`)
      }

      const courses = moodleCourses.map(mc => ({
        id: `moodle-${mc.id}`,
        title: mc.fullname,
        code: mc.shortname,
        description: mc.summary,
        url: `${cleanUrl}/course/view.php?id=${mc.id}`,
        lifecycleState: 'untouched',
      }))

      return {
        protocolVersion: 'v1',
        courses,
        schedules: [],
        sessions: [],
        warnings: [],
      }
    } catch (error) {
      return {
        protocolVersion: 'v1',
        courses: [],
        schedules: [],
        sessions: [],
        warnings: [`Failed to sync from Moodle: ${error.message}`],
      }
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
      warnings: ['Moodle push is metadata-only. Remote data was not modified.'],
    }
  },
}
