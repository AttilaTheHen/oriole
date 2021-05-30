import React, { FC, useState } from 'react';
import { Text, Box, useApp } from 'ink';
import SelectInput from 'ink-select-input';
import * as child from 'child_process';
import { getData } from '../../utils/store';
import { pushHarvestEntry } from '../../utils/harvest/harvest';
import { Error } from '../Error';
import { HarvestError } from '../../utils/harvest/harvest.interface';
import { Choice } from './Commits.interface';

export const Commits: FC = () => {
  const { exit } = useApp();
  const [gitLog, setGitLog] = useState('');
  const [showGitLog, setShowGitLog] = useState(false);
  const [error, setError] = useState<HarvestError>();
  const choices: Choice[] = [
    { label: 'Yes', value: 'y' },
    { label: 'No', value: 'n' },
  ];
  const currentDir = process.cwd().split('/');
  const dirName = currentDir[currentDir.length - 1];

  const handleSelect = async (item: Choice) => {
    if (item.value === 'y') {
      const projectId = await getData(`${dirName}.projectId`);
      const taskId = await getData(`${dirName}.taskId`);
      // TODO: Allow user to add custom date as flag, --date yyyy-mm-dd?
      const spentDate = new Date().toLocaleDateString('en-CA'); // today as yyyy-mm-dd
      // TODO: Hours? Currently just hardcoded 3. Same question as above too - add as flag?
      const hours = 3;
      const body = {
        project_id: Number(projectId),
        task_id: Number(taskId),
        spent_date: spentDate,
        hours,
        notes: gitLog,
      };
      // TODO: Make sure this is idempotent. Currently can just keep running command to add multiple of the same entry.
      pushHarvestEntry('https://api.harvestapp.com/v2/time_entries', body)
        .then(() => {
          console.log(`project: ${projectId}, task: ${taskId}`);
          // TODO: Add logic to clear out the commits text and display a success message (similar logic to displaying error).
          exit();
        })
        .catch((err) => {
          setError(err);
          exit();
        });
    } else {
      console.log('rejected');
      exit();
    }
  };

  if (!gitLog) {
    const log = child.execSync(
      'git log --author=$(git config user.email) --format="- %B" --no-merges -n 10',
    );
    const logString = log ? log.toString() : ''; // if log is null, like when exiting git log, there's an error - so ternary will resolve this
    // TODO: Think about an option for a ticket heading?
    const formattedLog = logString.replace(/(^[ \t]*\n)/gm, '');
    setGitLog(formattedLog);
    setShowGitLog(true);
  }

  // TODO: Componentize everything to clean up ternary?
  return (
    <Box flexDirection='column'>
      {error && error.status ? (
        <Error status={error.status} />
      ) : (
        <Box flexDirection='column'>
          <Text>Here are your latest commits in this repo:</Text>
          {showGitLog && (
            <Box marginTop={1} flexDirection='column'>
              <Text>{gitLog}</Text>
              <Box flexDirection='column'>
                <Text>Push these up to Harvest?</Text>
                <SelectInput items={choices} onSelect={handleSelect} />
              </Box>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
};