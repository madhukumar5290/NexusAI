const KEY_GROUPS = {

    user_job_role: [
        "user_works",
        "user_work",
        "user_job",
        "user_job_role",
        "user_current_position",
        "user_position",
        "user_profession",
        "user_role",
        "user_occupation",
        "user_career"
    ],

    user_favorite_project: [
        "user_favorite_project",
        "user_favourite_project",
        "favorite_project",
        "favourite_project"
    ],

    user_building_nexus_ai: [
        "user_building_nexus_ai",
        "building_nexus_ai",
        "user_nexus_ai_project"
    ],

    user_coding_preference: [
        "user_coding_preference",
        "coding_instruction_preference",
        "user_instruction_preference"
    ],

    user_uses_articulate_storyline: [
        "user_uses_articulate_storyline",
        "uses_articulate_storyline",
        "user_storyline_usage"
    ]

};

function normalizeMemoryKey(key) {

    if (!key) {
        return null;
    }

    const normalized =
        key
            .trim()
            .toLowerCase();

    for (
        const canonicalKey
        of Object.keys(KEY_GROUPS)
    ) {

        const aliases =
            KEY_GROUPS[canonicalKey];

        if (
            aliases.includes(
                normalized
            )
        ) {
            return canonicalKey;
        }
    }

    return normalized;
}

module.exports = {
    normalizeMemoryKey
};