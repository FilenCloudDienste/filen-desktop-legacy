# [Filen Desktop Client](https://github.com/FilenCloudDienste/filen-desktop) (JupiterPi fork)

## Additional features

This fork of the Filen desktop client adds the following functionality:

### Physical .filenignore

Adds the option of having a "physical" .filenignore file located at the root of a sync location. Its content is added to the content of the "virtual" .filenignore loaded from the local database.

**Advantages**: Additionally to the current "virtual" implementation, this allows the .filenignore file to be uploaded along with the files of a sync location, and thus for it to be downloaded along with the files when syncing to another device. (This is very useful for e. g. JavaScript source repositories where node_modules mustn't be uploaded to cloud storage on any device that clones the sync location locally.)

## Todo

- [ ] suppress updater